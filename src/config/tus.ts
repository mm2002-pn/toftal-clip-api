/**
 * TUS (Resumable Upload Protocol) Configuration
 *
 * Provides resumable, chunked uploads for large video files.
 * Backed by `@tus/gcs-store` — every chunk is written DIRECTLY to GCS
 * as it arrives, no local disk involvement. Implications:
 *
 *  - Cloud Run instances are stateless from the upload's perspective.
 *    Any instance can serve any chunk of any upload — no sticky sessions,
 *    no `/uploads/tus-temp/` ephemeral disk pressure, no async transfer
 *    after upload completion.
 *
 *  - Resume "just works": the GCS object holds the partial bytes, so a
 *    HEAD on the upload returns the correct offset. tus-js-client's
 *    findPreviousUploads → resumeFromPreviousUpload flow needs no
 *    server-side hint.
 *
 *  - The `videoUrl` is final the moment the upload completes; we don't
 *    have to copy bytes around in onUploadFinish, just create the
 *    Version row + fan out the workers.
 *
 * Features:
 *  - Chunked uploads (8 MB default)
 *  - Automatic resume on network failure
 *  - 10 GB max file size, 24 h session expiry
 *  - Behind Cloud Run / Google LB: respectForwardedHeaders so the
 *    `Location` header returned to the client uses HTTPS.
 */

import { Server, Upload } from '@tus/server';
import { GCSStore } from '@tus/gcs-store';
import { Storage } from '@google-cloud/storage';
import { MemoryLocker } from '@tus/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { generateVideoThumbnail } from '../services/VideoThumbnailService';
import { triggerFaststartJob } from '../services/faststartTrigger';
import { triggerPreviewJob } from '../services/previewTrigger';
import { triggerHlsJob } from '../services/hlsTrigger';
import { config } from '../config';

const prisma = new PrismaClient();

// Configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'toftal-clip-api';
const KEY_FILE = process.env.GCS_KEY_FILE;
const IS_CLOUD_RUN = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

// TUS Configuration
export const TUS_CONFIG = {
  // Maximum file size: 10GB
  maxSize: 10 * 1024 * 1024 * 1024,
  // Upload expiration: 24 hours
  expirationPeriodInMilliseconds: 24 * 60 * 60 * 1000,
  // Path where TUS uploads are handled
  path: '/api/v1/tus',
  // Chunk size: 8MB (optimal for GCS multipart writes)
  chunkSize: 8 * 1024 * 1024,
};

// Initialize GCS Storage
const storage = IS_CLOUD_RUN
  ? new Storage({ projectId: PROJECT_ID })
  : new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE || './gcs-key.json' });

const bucket = storage.bucket(BUCKET_NAME);

// GCSStore writes chunks directly to GCS — no local disk, no per-instance
// state, no sticky-session requirement.
const gcsStore = new GCSStore({ bucket });
console.log('☁️ TUS using GCSStore (chunks → gs://' + BUCKET_NAME + ' direct)');

/**
 * Generate the GCS object name for the upload. The id returned here
 * IS the GCS object path — `videos/<uuid>.<ext>` lands the upload at
 * exactly the same layout as the signed-URL multipart pipeline, so
 * downstream workers (faststart/preview/HLS) need no special handling.
 *
 * NOTE: the id contains a `/`, which means the default `@tus/server`
 * URL→id regex (last segment only) would parse it back as just
 * `<uuid>.<ext>` and miss `videos/`. We pair this with a custom
 * `getFileIdFromRequest` below so the slash round-trips intact.
 */
const namingFunction = (
  _req: unknown,
  metadata?: Record<string, string | null>
): string => {
  const filename = metadata?.filename || '';
  const ext = path.extname(filename).toLowerCase() || '.mp4';
  return `videos/${uuidv4()}${ext}`;
};

/**
 * Custom URL→id parser. Default `/([^/]+)\/?$/` only grabs the last
 * path segment, so our `videos/<uuid>.<ext>` ids would lose the
 * `videos/` prefix on every PATCH/HEAD/DELETE and the GCS lookup
 * would 404.
 *
 * @tus/server passes a fetch-API Request here, so `req.url` is the
 * full absolute URL (`https://host/api/v1/tus/...`), not just the
 * path — extract the pathname before stripping the prefix.
 */
const getFileIdFromRequest = (req: any): string | undefined => {
  const raw: string = req?.url || '';
  if (!raw) return undefined;
  let pathname: string;
  try {
    pathname = new URL(raw, 'http://placeholder').pathname;
  } catch {
    pathname = raw;
  }
  const prefix = `${TUS_CONFIG.path}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const id = pathname.slice(prefix.length).replace(/\/$/, '');
  if (!id) return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/**
 * Validate the upload at creation time — file type, size cap.
 */
const onUploadCreate = async (
  _req: any,
  upload: Upload
): Promise<{ metadata?: Record<string, string | null> }> => {
  console.log('🎬 TUS Upload created:', upload.id);

  const metadata = upload.metadata || {};
  const filetype = metadata.filetype || '';
  const allowedTypes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-matroska',
  ];

  if (filetype && !allowedTypes.includes(filetype)) {
    throw {
      status_code: 415,
      body: `Unsupported file type: ${filetype}. Allowed: ${allowedTypes.join(', ')}`,
    };
  }

  if (upload.size && upload.size > TUS_CONFIG.maxSize) {
    throw {
      status_code: 413,
      body: `File too large. Maximum size: ${TUS_CONFIG.maxSize / (1024 * 1024 * 1024)} GB`,
    };
  }

  return { metadata: upload.metadata };
};

/**
 * Once the last chunk has landed on GCS, register the Version row and
 * fan out the three video-pipeline workers. The bytes are already at
 * their final GCS path — no copy needed, no cleanup either.
 */
const onUploadFinish = async (
  req: any,
  upload: Upload
): Promise<{ status_code?: number; body?: string }> => {
  console.log(`✅ TUS Upload finished: ${upload.id} (${upload.size} bytes)`);

  const userId = req.user?.id;
  const metadata = upload.metadata || {};
  const deliverableId = metadata.deliverableId || null;
  const versionNumber = metadata.versionNumber ? parseInt(metadata.versionNumber, 10) : 1;
  const filename = metadata.filename || 'upload.mp4';

  // upload.id is the GCS object key (set by namingFunction).
  const videoUrl = `${config.media.publicBaseUrl}${upload.id}`;

  if (!deliverableId || !userId) {
    console.warn(
      '[tus] no deliverableId or userId — skipping Version creation',
      { deliverableId, userId, uploadId: upload.id }
    );
    return {};
  }

  console.log('📝 Registering version for deliverable:', deliverableId);

  const version = await prisma.version.create({
    data: {
      deliverableId,
      versionNumber,
      videoUrl,
      status: 'PROCESSING',
      uploadedById: userId,
      fileSize: upload.size ? BigInt(upload.size) : null,
      metadata: {
        fileSize: upload.size || 0,
        originalFileName: filename,
      },
    },
  });

  console.log('✅ Version created:', version.id);

  // Thumbnail (fire-and-forget, mirrors the REST upload path).
  setImmediate(async () => {
    const thumbnailUrl = await generateVideoThumbnail(videoUrl);
    if (!thumbnailUrl) return;
    try {
      await prisma.version.update({
        where: { id: version.id },
        data: { thumbnailUrl },
      });
    } catch (err) {
      console.warn('Thumbnail persist failed (TUS):', err);
    }
  });

  // Three video-pipeline workers in parallel. See the deliverables
  // controller for the same fan-out used on signed-URL uploads.
  setImmediate(() => {
    void triggerFaststartJob(version.id);
  });
  setImmediate(() => {
    void triggerPreviewJob(version.id);
  });
  setImmediate(() => {
    void triggerHlsJob(version.id);
  });

  return {};
};

/**
 * Best-effort progress lookup — uses the GCSStore's getUpload to read
 * the object's current size. Used by the optional /progress/:id REST
 * endpoint; not on the hot path.
 */
export const getUploadProgress = async (
  uploadId: string
): Promise<{ id: string; offset: number; size: number | null } | null> => {
  try {
    const u = await gcsStore.getUpload(uploadId);
    return {
      id: uploadId,
      offset: u.offset,
      size: u.size ?? null,
    };
  } catch {
    return null;
  }
};

/**
 * Create and configure the TUS Server.
 */
export const createTusServer = (): Server => {
  return new Server({
    path: TUS_CONFIG.path,
    datastore: gcsStore,
    maxSize: TUS_CONFIG.maxSize,
    locker: new MemoryLocker(),
    // Cloud Run / GCLB terminates TLS upstream — without this, the
    // Location header returned to the browser uses http:// and gets
    // blocked as mixed content on the HTTPS frontend.
    respectForwardedHeaders: true,
    allowedHeaders: [
      'Authorization',
      'X-Tus-Token',
      'Upload-Length',
      'Upload-Offset',
      'Tus-Resumable',
      'Upload-Metadata',
      'Upload-Concat',
      'Upload-Defer-Length',
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'Content-Type',
    ],
    exposedHeaders: [
      'Upload-Offset',
      'Location',
      'Upload-Length',
      'Tus-Version',
      'Tus-Resumable',
      'Tus-Max-Size',
      'Tus-Extension',
      'Upload-Metadata',
      'X-Final-Url',
      'X-Version-Id',
      'X-Video-Url',
      'X-Upload-Id',
    ],
    namingFunction,
    getFileIdFromRequest,
    onUploadCreate,
    onUploadFinish,
  });
};

export { storage, bucket, BUCKET_NAME };
