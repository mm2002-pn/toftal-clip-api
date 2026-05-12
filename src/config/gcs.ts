import { Storage } from '@google-cloud/storage';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'toftal-clip-api';
const KEY_FILE = process.env.GCS_KEY_FILE;
const IS_CLOUD_RUN = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

/**
 * Public base URL the frontend should use to fetch media. Set to the
 * Cloud CDN domain in staging/prod (`https://media.staging.toftalclip.io/`),
 * falls back to direct GCS in dev.
 *
 * Why we don't just `storage.googleapis.com/...` everywhere
 * ────────────────────────────────────────────────────────
 * Direct GCS = no CDN, no edge cache, ~200-300 ms first-byte latency
 * from West Africa to Google's EU/US data centers. On a 1h video the
 * browser issues hundreds of range requests during seek + buffer
 * fill, multiplying that latency. Routing through Cloud CDN cuts
 * tail latency by ~80% on first hit and to near-zero on cache hits.
 *
 * Returning the CDN URL from the upload pipeline means the very
 * first playback after upload already benefits from the CDN, before
 * the faststart worker has even run.
 */
const MEDIA_PUBLIC_BASE_URL =
  process.env.MEDIA_PUBLIC_BASE_URL || `https://storage.googleapis.com/${BUCKET_NAME}/`;

function buildPublicUrl(fileName: string): string {
  return `${MEDIA_PUBLIC_BASE_URL}${fileName}`;
}

// Initialize storage
// In Cloud Run (production/staging), use Application Default Credentials
// In development, use service account key file
const storage = IS_CLOUD_RUN
  ? new Storage({ projectId: PROJECT_ID })
  : new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE || './gcs-key.json' });

const bucket = storage.bucket(BUCKET_NAME);

export interface GCSUploadResult {
  url: string;
  publicUrl: string;
  fileName: string;
  bucket: string;
  contentType: string;
  size: number;
}

/**
 * Upload a file to Google Cloud Storage
 */
export const uploadToGCS = async (
  filePath: string,
  originalName: string,
  mimeType: string,
  folder: string = 'uploads',
  /**
   * Optional Content-Disposition override. Set to e.g.
   *   `attachment; filename="my-video.mp4"`
   * for files that should always be downloaded (not played inline). The
   * downscale worker uses this so mobile browsers can save the file
   * via a plain anchor click instead of buffering the whole video in
   * JS memory (which OOMs on iOS for ~200 MB+ files).
   */
  contentDisposition?: string,
  /**
   * Optional Content-Type override. iOS Safari sometimes ignores
   * Content-Disposition: attachment for media MIME types and plays the
   * file inline instead of saving it (showing a black screen if the
   * H.264 profile isn't supported by AVFoundation). Set this to
   * `application/octet-stream` for files that MUST download.
   */
  contentTypeOverride?: string
): Promise<GCSUploadResult> => {
  // Generate unique filename
  const ext = path.extname(originalName);
  const fileName = `${folder}/${uuidv4()}${ext}`;

  // Upload file.
  // The generated fileName contains a UUID, so the URL is immutable — we can
  // tell browsers + CDN to cache it forever. `immutable` tells the browser
  // never to send revalidation requests (0ms reload instead of ~200ms HEAD).
  await bucket.upload(filePath, {
    destination: fileName,
    metadata: {
      contentType: contentTypeOverride || mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
      ...(contentDisposition ? { contentDisposition } : {}),
      metadata: {
        originalName: originalName,
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  const file = bucket.file(fileName);

  // Get file metadata for size
  const [metadata] = await file.getMetadata();

  // Generate signed URL (valid for 7 days) or public URL
  const publicUrl = buildPublicUrl(fileName);

  return {
    url: publicUrl,
    publicUrl,
    fileName,
    bucket: BUCKET_NAME,
    contentType: mimeType,
    size: Number(metadata.size) || 0,
  };
};

/**
 * Upload image to GCS
 */
export const uploadImageToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  return uploadToGCS(filePath, originalName, mimeType, 'images');
};

/**
 * Upload video to GCS
 */
export const uploadVideoToGCS = async (
  filePath: string,
  originalName: string,
  /** Optional Content-Disposition — see uploadToGCS. */
  contentDisposition?: string,
  /** Optional Content-Type override — see uploadToGCS. */
  contentTypeOverride?: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
  };
  const mimeType = mimeTypes[ext] || 'video/mp4';

  return uploadToGCS(filePath, originalName, mimeType, 'videos', contentDisposition, contentTypeOverride);
};

/**
 * Upload audio (voice note) to GCS.
 *
 * Essential for iOS: iPhone/iPad records voice notes as MP4/AAC, so the
 * extension is `.mp4`. The browser <audio> element needs a proper
 * Content-Type of `audio/mp4` (or `audio/aac`) to play it — serving
 * `application/octet-stream` or `video/mp4` makes desktop browsers show
 * errors or try to render the track as video.
 */
export const uploadAudioToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'audio/mp4',     // iOS Safari native format
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',   // Chrome / Android default
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
  };
  const mimeType = mimeTypes[ext] || 'audio/mp4';
  return uploadToGCS(filePath, originalName, mimeType, 'audio');
};

/**
 * Upload PDF/Document to GCS
 */
export const uploadDocumentToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    // Fallback when an audio file is (mis-)uploaded via this helper. Ideally
    // callers should use uploadAudioToGCS for audio instead.
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  return uploadToGCS(filePath, originalName, mimeType, 'documents');
};

/**
 * Generate a signed URL for temporary access (read)
 */
export const getSignedUrl = async (
  fileName: string,
  expiresInMinutes: number = 60
): Promise<string> => {
  const file = bucket.file(fileName);

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });

  return signedUrl;
};

/**
 * Signed URL for a download with response-header overrides. The CDN
 * (when in front of GCS) and GCS itself honour these on a signed
 * request even when the underlying object's stored metadata says
 * something else. We use this to force a browser save dialog on the
 * "Original" download path WITHOUT touching the playback URL of the
 * same object (which still serves with video/mp4 + no CD for the
 * player). Returns a fresh signed URL valid for `expiresInMinutes`.
 */
export const getSignedDownloadUrl = async (
  fileName: string,
  suggestedFilename: string,
  expiresInMinutes: number = 60
): Promise<string> => {
  const file = bucket.file(fileName);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    responseDisposition: `attachment; filename="${suggestedFilename}"`,
    // application/octet-stream so iOS Safari doesn't try to play the
    // video inline — see DownloadContext for the rationale.
    responseType: 'application/octet-stream',
  });
  return signedUrl;
};

/**
 * Generate a signed URL for upload (write)
 */
export const getUploadSignedUrl = async (
  fileName: string,
  contentType: string,
  expiresInMinutes: number = 60
): Promise<{ signedUrl: string; publicUrl: string }> => {
  // Generate unique filename with folder structure
  const ext = path.extname(fileName);
  const uniqueFileName = `videos/${uuidv4()}${ext}`;

  const file = bucket.file(uniqueFileName);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType: contentType,
  });

  const publicUrl = buildPublicUrl(uniqueFileName);

  return {
    signedUrl,
    publicUrl,
  };
};

/**
 * Delete a file from GCS
 */
export const deleteFromGCS = async (fileName: string): Promise<void> => {
  const file = bucket.file(fileName);
  await file.delete({ ignoreNotFound: true });
};

/**
 * Check if file exists
 */
export const fileExistsInGCS = async (fileName: string): Promise<boolean> => {
  const file = bucket.file(fileName);
  const [exists] = await file.exists();
  return exists;
};

/**
 * Make bucket files publicly readable (call once during setup)
 */
export const makeBucketPublic = async (): Promise<void> => {
  await bucket.makePublic();
};

export { storage, bucket, BUCKET_NAME };
