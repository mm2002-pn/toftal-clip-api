/**
 * Preview worker — Cloud Run Job entry point.
 *
 * Phase 1.5 of the playback overhaul. Sits between faststart and HLS
 * in the latency budget: produces a small, mobile-friendly MP4 (480p,
 * h264 ultrafast, AAC) that the user can stream over a 3G connection
 * within minutes of upload.
 *
 *   • Faststart  — tens of seconds, gives moov-at-front of the SOURCE
 *     resolution. Useless for big sources because the file is still
 *     huge — Africa-mobile users still buffer for ages.
 *   • Preview (this) — single 480p MP4 ~1 Mbps cap, ultrafast preset.
 *     ~5–10× faster than the full HLS encode while producing a file
 *     small enough to stream anywhere.
 *   • HLS — full ABR ladder, 5–60 min depending on duration. Best UX
 *     once it lands; the preview is what bridges the gap.
 *
 * The frontend uses whichever artefact is ready in priority order
 * (HLS > preview > faststart > raw source). Each worker is fire-and-
 * forget from the deliverables controller, all three run in parallel.
 *
 * Sizing (set in cloudbuild yamls): 8 vCPU / 16 Gi / gen2 — preview
 * is the most CPU-bound stage relative to its wall-clock target.
 *
 * Idempotence: skips when `alternativeQualities.preview` is already
 * populated for the version (re-runs from Job retries don't re-encode
 * a successful one).
 */

import { exec, spawn } from 'child_process';
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

/** ffprobe → just enough to know if there's audio (matters for `-c:a`). */
async function probeAudio(input: string): Promise<boolean> {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams a -show_entries stream=index -of json "${input}"`,
    { maxBuffer: 4 * 1024 * 1024 }
  );
  try {
    const json = JSON.parse(stdout);
    return Array.isArray(json.streams) && json.streams.length > 0;
  } catch {
    return false;
  }
}

/**
 * The preview encode command.
 *
 *   • `-preset ultrafast` is the speed-vs-size sweet spot — ~3-4×
 *     faster than `fast` at the cost of ~30% larger output. For a
 *     temporary 480p preview that's an acceptable trade.
 *   • `scale=854:-2:force_divisible_by=2` caps width at 854 (16:9 480p)
 *     and rounds to even — h264 refuses odd dimensions (vertical 9:16
 *     sources used to bite us in HLS, same fix here).
 *   • `-b:v 800k -maxrate 1M` keeps the file streamable on 1 Mbps mobile.
 *   • `-movflags +faststart` puts the moov atom at the head, so the
 *     browser paints the first frame on the first range request.
 *   • `-threads 0` = use all available CPU cores in the Job.
 */
function buildFfmpegCommand(input: string, output: string, hasAudio: boolean): string {
  const parts = [
    `ffmpeg -y -i "${input}"`,
    `-c:v libx264 -preset ultrafast -tune zerolatency -crf 28`,
    `-vf "scale=854:-2:force_original_aspect_ratio=decrease:force_divisible_by=2"`,
    `-b:v 800k -maxrate 1M -bufsize 1500k`,
    `-pix_fmt yuv420p`,
    `-threads 0`,
  ];
  if (hasAudio) {
    parts.push(`-c:a aac -b:a 96k -ar 48000 -ac 2`);
  } else {
    parts.push(`-an`);
  }
  parts.push(`-movflags +faststart`, `"${output}"`);
  return parts.join(' ');
}

/**
 * Run ffmpeg via spawn so we don't buffer hours of stderr in memory
 * — same pattern as the HLS worker.
 */
function runFfmpeg(cmd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', () => undefined);
    proc.stderr?.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line) logger.info(`[preview/ffmpeg] ${line.slice(0, 500)}`);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * POST `/api/v1/internal/preview-ready` — same auth pattern as the
 * faststart and HLS notifies.
 */
async function notifyApiPreviewReady(payload: {
  projectId: string;
  deliverableId: string;
  versionId: string;
  previewUrl: string;
}): Promise<void> {
  const baseUrl = config.internal.apiBaseUrl;
  const secret = config.internal.apiSecret;
  if (!baseUrl || !secret) {
    logger.warn('[preview] INTERNAL_API_BASE_URL or INTERNAL_API_SECRET missing, skipping notify');
    return;
  }

  const url = new URL('/api/v1/internal/preview-ready', baseUrl);
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
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`API ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('notify timeout')));
    req.write(body);
    req.end();
  });
}

/** Mirror of the helper in hls.ts — accept either GCS direct or CDN URL. */
function gcsSourcePath(videoUrl: string): string | null {
  let url = videoUrl;
  if (url.startsWith(PUBLIC_GCS_PREFIX)) {
    url = decodeURIComponent(url.slice(PUBLIC_GCS_PREFIX.length).split('?')[0]);
  } else if (
    config.media.publicBaseUrl !== PUBLIC_GCS_PREFIX &&
    url.startsWith(config.media.publicBaseUrl)
  ) {
    url = decodeURIComponent(url.slice(config.media.publicBaseUrl.length).split('?')[0]);
  } else {
    return null;
  }
  // The preview always encodes the original source — never the
  // playable.mp4 (would be a re-encode of an already-remuxed file).
  // The faststart worker writes _playable.mp4 → strip it back to the
  // source filename.
  return url.replace(/_playable\.mp4$/, (m) => {
    void m;
    // Without the original extension, fall back to .mp4 — the source
    // file may have been .mov but at this point the row's videoUrl was
    // already mutated by faststart. Best-effort: try .mp4 first.
    return '.mp4';
  });
}

async function processPreview(versionId: string): Promise<void> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: {
      deliverable: { include: { project: { select: { id: true } } } },
    },
  });
  if (!version) {
    logger.warn(`[preview] version ${versionId} not found`);
    return;
  }
  if (!version.videoUrl) {
    logger.warn(`[preview] version ${versionId} has no videoUrl`);
    return;
  }

  // Idempotence — skip if already encoded.
  const altQ = (version.alternativeQualities as { preview?: string } | null) || null;
  if (altQ?.preview) {
    logger.info(`[preview] version ${versionId} already encoded, skipping`);
    return;
  }

  const gcsPath = gcsSourcePath(version.videoUrl);
  if (!gcsPath) {
    logger.warn(`[preview] cannot map ${version.videoUrl} to a GCS path`);
    return;
  }

  // Disconnect Prisma before the long encode/upload — same Cloud SQL
  // idle-timeout reasoning as the other workers.
  await prisma.$disconnect();

  const ext = path.extname(gcsPath);
  const stem = gcsPath.slice(0, gcsPath.length - ext.length);
  const previewPath = `${stem}_preview.mp4`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-'));
  const tmpInput = path.join(tmp, `in-${uuidv4()}${ext}`);
  const tmpOutput = path.join(tmp, `out-${uuidv4()}.mp4`);

  const storage = new Storage();
  const bucket = storage.bucket(config.media.bucketName);

  try {
    // 1. Download source.
    logger.info(`[preview] downloading gs://${config.media.bucketName}/${gcsPath}`);
    const dlStart = Date.now();
    await bucket.file(gcsPath).download({ destination: tmpInput });
    logger.info(`[preview] downloaded in ${Math.round((Date.now() - dlStart) / 1000)}s`);

    // 2. Probe audio so we don't `-c:a aac` on a silent source.
    const hasAudio = await probeAudio(tmpInput);
    logger.info(`[preview] audio=${hasAudio}`);

    // 3. Encode.
    logger.info(`[preview] encoding 480p ultrafast…`);
    const ffStart = Date.now();
    await runFfmpeg(buildFfmpegCommand(tmpInput, tmpOutput, hasAudio), 12 * 60 * 1000);
    logger.info(`[preview] encoded in ${Math.round((Date.now() - ffStart) / 1000)}s`);

    // 4. Upload preview.
    logger.info(`[preview] uploading to gs://${config.media.bucketName}/${previewPath}`);
    const upStart = Date.now();
    await bucket.upload(tmpOutput, {
      destination: previewPath,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          source: gcsPath,
          encodedAt: new Date().toISOString(),
        },
      },
    });
    logger.info(`[preview] uploaded in ${Math.round((Date.now() - upStart) / 1000)}s`);

    const previewUrl = `${config.media.publicBaseUrl}${previewPath}`;

    // 5. Update DB. Merge into alternativeQualities so we don't blow
    // away the HLS master if it landed first (race possible since the
    // 3 workers run in parallel).
    await prisma.version.update({
      where: { id: versionId },
      data: {
        alternativeQualities: { ...(altQ || {}), preview: previewUrl },
      },
    });

    // 6. Tell the API to broadcast.
    const projectId = version.deliverable?.project?.id;
    if (projectId) {
      await notifyApiPreviewReady({
        projectId,
        deliverableId: version.deliverableId,
        versionId,
        previewUrl,
      }).catch((err) =>
        logger.warn(`[preview] notify failed for ${versionId}: ${(err as Error).message}`)
      );
    }

    logger.info(`[preview] ✅ done ${versionId} → ${previewPath}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const versionId = process.env.VERSION_ID;
  if (!versionId) {
    console.error('[preview] VERSION_ID env var required');
    process.exit(1);
  }
  try {
    await processPreview(versionId);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error(`[preview] ❌ failed ${versionId}: ${(err as Error).message}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
}

void main();
