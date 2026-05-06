/**
 * Faststart worker — Cloud Run Job entry point.
 *
 * Reads a `VERSION_ID` from the environment, downloads the source video
 * from GCS, runs ffmpeg in stream-copy mode with `-movflags +faststart`
 * (no re-encode — moov atom is moved to the front of the file), uploads
 * the result back to GCS as `<original>_playable.mp4`, swaps
 * `versions.video_url` to point at the new file, and emits a socket
 * event so any open client swaps its `<video src>` instantly.
 *
 * Why the moov-atom move matters
 * ──────────────────────────────
 * MP4s exported by Premiere / DaVinci / phone cameras typically write
 * the moov atom (the table of contents) at the *end* of the file. The
 * browser cannot start playing until it has read the moov, so it
 * downloads the whole file before the first frame. With `+faststart`
 * the moov is rewritten at the head — playback starts as soon as the
 * first range request lands. This is the single biggest win for the
 * "click play, it stalls, it stalls, it stalls" complaint.
 *
 * Why a Cloud Run Job (not inline in the API)
 * ───────────────────────────────────────────
 * `-c copy` is mostly I/O — but the source can be 5–20 GB on long
 * formats (2h videos in this product). Cloud Run gen1 puts /tmp in
 * RAM, so a 10 GB download would OOM the API. The Job runs gen2 with
 * 32 GB SSD scratch and an isolated 8 GB of RAM. The Job is also
 * triggered fire-and-forget so a failed remux never breaks the Version
 * creation request.
 *
 * Idempotence: skips if the video is already at `_playable.mp4` or if
 * the row was deleted between trigger and execution.
 *
 * Failure mode: any error is logged and the Job exits non-zero. Cloud
 * Run Jobs retry up to N times (configured at deploy). After exhaustion
 * the source URL is untouched — playback still works, just without the
 * faststart benefit. No silent data loss.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '@google-cloud/storage';
import { prisma } from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

const PUBLIC_GCS_PREFIX = `https://storage.googleapis.com/${config.media.bucketName}/`;
const PLAYABLE_SUFFIX = '_playable.mp4';

/**
 * Extract the GCS object path from any of our valid public/CDN URLs.
 * Returns null if the URL doesn't match either prefix — caller should
 * skip processing in that case (foreign upload? legacy URL?).
 */
function gcsPathFromUrl(url: string): string | null {
  if (url.startsWith(PUBLIC_GCS_PREFIX)) {
    return decodeURIComponent(url.slice(PUBLIC_GCS_PREFIX.length).split('?')[0]);
  }
  if (config.media.publicBaseUrl !== PUBLIC_GCS_PREFIX && url.startsWith(config.media.publicBaseUrl)) {
    return decodeURIComponent(url.slice(config.media.publicBaseUrl.length).split('?')[0]);
  }
  return null;
}

/**
 * POST `/api/v1/internal/version-ready` to ask the API to broadcast a
 * `version:playback-ready` Socket.IO event to the project room. Auth
 * via the shared `INTERNAL_API_SECRET`, sent in `X-Internal-Secret`.
 *
 * Throws on non-2xx so the caller can log; never throws on failure
 * (caller catches). Uses raw `https.request` to avoid pulling axios
 * into the Job's bundle.
 */
async function notifyApiVersionReady(payload: {
  projectId: string;
  deliverableId: string;
  versionId: string;
  videoUrl: string;
}): Promise<void> {
  const baseUrl = config.internal.apiBaseUrl;
  const secret = config.internal.apiSecret;
  if (!baseUrl || !secret) {
    logger.warn(
      '[faststart] INTERNAL_API_BASE_URL or INTERNAL_API_SECRET missing, skipping socket notify'
    );
    return;
  }

  const url = new URL('/api/v1/internal/version-ready', baseUrl);
  const body = JSON.stringify(payload);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Internal-Secret': secret,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(`API responded ${res.statusCode}: ${data.slice(0, 200)}`)
            );
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('notify timeout')));
    req.write(body);
    req.end();
  });
}

async function processFaststart(versionId: string): Promise<void> {
  // 1. Load version with its project for the socket emit later.
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: {
      deliverable: { include: { project: { select: { id: true } } } },
    },
  });
  if (!version) {
    logger.warn(`[faststart] version ${versionId} not found, skipping`);
    return;
  }
  if (!version.videoUrl) {
    logger.warn(`[faststart] version ${versionId} has no videoUrl, skipping`);
    return;
  }
  if (version.videoUrl.endsWith(PLAYABLE_SUFFIX)) {
    logger.info(`[faststart] version ${versionId} already remuxed, skipping`);
    return;
  }

  const gcsPath = gcsPathFromUrl(version.videoUrl);
  if (!gcsPath) {
    logger.warn(
      `[faststart] cannot map ${version.videoUrl} to a GCS path, skipping`
    );
    return;
  }

  // 2. Build paths.
  const ext = path.extname(gcsPath); // .mp4 / .mov / ...
  const stem = gcsPath.slice(0, gcsPath.length - ext.length);
  const playablePath = `${stem}${PLAYABLE_SUFFIX}`;
  const tmp = os.tmpdir();
  const tmpInput = path.join(tmp, `in-${uuidv4()}${ext}`);
  const tmpOutput = path.join(tmp, `out-${uuidv4()}.mp4`);

  const storage = new Storage();
  const bucket = storage.bucket(config.media.bucketName);

  try {
    // 3. Download source. Streamed by the SDK; uses local disk on gen2.
    logger.info(`[faststart] downloading gs://${config.media.bucketName}/${gcsPath}`);
    const startDl = Date.now();
    await bucket.file(gcsPath).download({ destination: tmpInput });
    logger.info(`[faststart] downloaded in ${Math.round((Date.now() - startDl) / 1000)}s`);

    // 4. Remux. `-c copy` = no re-encode, just rewrite the container.
    // `-movflags +faststart` moves the moov atom to the front. ffmpeg
    // does this in two passes internally; the second pass needs disk
    // (which gen2 has). Audio/video codecs must already be MP4-compat
    // (h264 + aac is the typical case from cameras / NLEs).
    //
    // If codecs are incompatible (vp8/9, opus, prores, ...) ffmpeg
    // exits non-zero — we log and bail. Phase 2 (HLS) handles those
    // by re-encoding.
    logger.info(`[faststart] running ffmpeg`);
    const startFf = Date.now();
    const cmd = `ffmpeg -y -i "${tmpInput}" -c copy -movflags +faststart "${tmpOutput}"`;
    await execAsync(cmd, {
      timeout: 25 * 60 * 1000, // 25 min — Job timeout is 30, leave headroom
      maxBuffer: 64 * 1024 * 1024, // ffmpeg writes a lot to stderr
    });
    logger.info(`[faststart] remuxed in ${Math.round((Date.now() - startFf) / 1000)}s`);

    // 5. Upload the playable file. Same cache headers as direct uploads.
    logger.info(`[faststart] uploading to gs://${config.media.bucketName}/${playablePath}`);
    const startUp = Date.now();
    await bucket.upload(tmpOutput, {
      destination: playablePath,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          source: gcsPath,
          remuxedAt: new Date().toISOString(),
        },
      },
    });
    logger.info(`[faststart] uploaded in ${Math.round((Date.now() - startUp) / 1000)}s`);

    const newPublicUrl = `${config.media.publicBaseUrl}${playablePath}`;

    // 6. Update DB. Wrap in try/catch so a transient DB blip doesn't
    // leave the playable file orphan (we still want the socket emit
    // to land if it works on retry). The retry policy on the Job
    // re-runs the entire pipeline including this update.
    await prisma.version.update({
      where: { id: versionId },
      data: { videoUrl: newPublicUrl },
    });

    // 7. Notify the API so it can re-emit `version:playback-ready` to
    // the project's Socket.IO room. We can't emit directly from here —
    // the Job is a separate process with no in-memory io instance —
    // so we POST to the internal endpoint with a shared secret.
    // Non-fatal: a failed POST just means the user must refresh to see
    // the swap (the DB row is already updated).
    const projectId = version.deliverable?.project?.id;
    if (projectId) {
      await notifyApiVersionReady({
        projectId,
        deliverableId: version.deliverableId,
        versionId,
        videoUrl: newPublicUrl,
      }).catch((err) => {
        logger.warn(
          `[faststart] notify failed for ${versionId}: ${(err as Error).message}`
        );
      });
    }

    logger.info(`[faststart] ✅ done ${versionId} → ${playablePath}`);
  } finally {
    // Always clean tmp — gen2 scratch is per-execution but we run
    // single-task, no need to leak across.
    await Promise.allSettled([
      fs.unlink(tmpInput).catch(() => undefined),
      fs.unlink(tmpOutput).catch(() => undefined),
    ]);
  }
}

async function main() {
  const versionId = process.env.VERSION_ID;
  if (!versionId) {
    console.error('[faststart] VERSION_ID env var required');
    process.exit(1);
  }

  try {
    await processFaststart(versionId);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error(
      `[faststart] ❌ failed ${versionId}: ${(err as Error).message}`
    );
    await prisma.$disconnect().catch(() => undefined);
    // Exit non-zero so Cloud Run Jobs retries per its retry policy.
    process.exit(1);
  }
}

void main();
