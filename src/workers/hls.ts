/**
 * HLS multi-quality encode worker — Cloud Run Job entry point.
 *
 * Phase 2 of the playback overhaul. Reads `VERSION_ID` from env,
 * downloads the source MP4, runs ffmpeg to generate a 4-rung HLS
 * ladder (1080p / 720p / 480p / 240p), uploads master playlist +
 * variant playlists + segments to GCS under `hls/<uuid>/`, updates
 * `versions.alternative_qualities = { master: <url> }`, and posts
 * the new master URL to the API so it can broadcast a
 * `version:hls-ready` socket event.
 *
 * Why a separate worker (not the same as faststart)
 * ─────────────────────────────────────────────────
 * Faststart is `-c copy` — pure I/O, finishes in seconds. HLS is a
 * full re-encode — CPU-bound, takes 2–3× the source duration even
 * with `preset=fast`. Sizing them together would pay for 4 vCPU /
 * 2h timeout on every faststart for nothing. Two Jobs, two budgets.
 *
 * Both Jobs are triggered in parallel from the deliverables
 * controller. Faststart usually finishes in <30s and gives the user
 * fast playback; HLS lands minutes later and the frontend swaps to
 * adaptive bitrate via `version:hls-ready`.
 *
 * Quality ladder (4 rungs)
 * ────────────────────────
 *   1080p — 5 Mbps  / 128 kbps audio
 *    720p — 2.5 Mbps / 128 kbps audio
 *    480p — 1.2 Mbps /  96 kbps audio
 *    240p — 400 kbps /  64 kbps audio
 *
 * `force_original_aspect_ratio=decrease` ensures we never *upscale*
 * a 720p source to 1080p (would just waste bytes). When the source
 * is smaller than a target rung, ffmpeg keeps the source resolution
 * for that variant. Good enough for v1; a future optimisation is to
 * skip variants entirely when source < target.
 *
 * Layout on GCS
 * ─────────────
 *   hls/<uuid>/master.m3u8                  ← what the player loads
 *   hls/<uuid>/1080p/playlist.m3u8
 *   hls/<uuid>/1080p/seg_000.ts
 *   hls/<uuid>/1080p/seg_001.ts
 *   hls/<uuid>/720p/...
 *   hls/<uuid>/480p/...
 *   hls/<uuid>/240p/...
 *
 * Idempotence: skips if `alternative_qualities.master` is already
 * populated for the version (re-runs from Job retries don't re-encode
 * a successful one).
 *
 * Failure mode: any error logs + non-zero exit. Cloud Run Jobs retry
 * per its policy. After exhaustion, the user keeps Phase 1 faststart
 * playback — no silent breakage, just no ABR.
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

interface SourceProbe {
  width: number;
  height: number;
  duration: number;
}

/** ffprobe → grab source resolution + duration. */
async function probe(input: string): Promise<SourceProbe> {
  const { stdout } = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of json "${input}"`,
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const json = JSON.parse(stdout);
  const stream = json.streams?.[0] ?? {};
  const fmt = json.format ?? {};
  return {
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    duration: Number(fmt.duration || 0),
  };
}

/**
 * Build the ffmpeg command that encodes the 4 HLS variants in one
 * shot. The single-ffmpeg approach decodes the source ONCE and feeds
 * the decoded frames into 4 parallel scaler+encoder pipelines, so
 * we don't pay the decode cost 4 times.
 *
 * `tmpDir` must already contain pre-created subfolders for each
 * quality (1080p/, 720p/, 480p/, 240p/) since ffmpeg's
 * `hls_segment_filename` template doesn't auto-mkdir.
 */
function buildFfmpegCommand(input: string, tmpDir: string): string {
  // -loglevel info keeps the per-segment progress quiet but surfaces
  // anything that goes wrong. The %v variable expands to the variant
  // name (1080p / 720p / ...) per `var_stream_map`.
  return [
    `ffmpeg -y -i "${input}"`,
    // Split the decoded video into 4 streams once; downscale per rung.
    `-filter_complex "[0:v]split=4[v1][v2][v3][v4];`,
    `[v1]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v1out];`,
    `[v2]scale=w=1280:h=720:force_original_aspect_ratio=decrease[v2out];`,
    `[v3]scale=w=854:h=480:force_original_aspect_ratio=decrease[v3out];`,
    `[v4]scale=w=426:h=240:force_original_aspect_ratio=decrease[v4out]"`,
    // Video encoders — h264 with `preset=fast` for a 2× speedup vs
    // `medium` at ~5% larger file (acceptable trade-off).
    `-map "[v1out]" -c:v:0 libx264 -preset fast -crf 23 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k`,
    `-map "[v2out]" -c:v:1 libx264 -preset fast -crf 23 -b:v:1 2500k -maxrate:v:1 2675k -bufsize:v:1 3750k`,
    `-map "[v3out]" -c:v:2 libx264 -preset fast -crf 23 -b:v:2 1200k -maxrate:v:2 1284k -bufsize:v:2 1800k`,
    `-map "[v4out]" -c:v:3 libx264 -preset fast -crf 28 -b:v:3 400k -maxrate:v:3 428k -bufsize:v:3 600k`,
    // Audio — re-encode once at the highest rate, dupe to other rungs.
    `-map a:0 -c:a:0 aac -b:a:0 128k -ar 48000 -ac 2`,
    `-map a:0 -c:a:1 aac -b:a:1 128k -ar 48000 -ac 2`,
    `-map a:0 -c:a:2 aac -b:a:2 96k -ar 48000 -ac 2`,
    `-map a:0 -c:a:3 aac -b:a:3 64k -ar 48000 -ac 2`,
    // Force keyframes every 2s so segment boundaries are clean (avoids
    // the player having to seek back when switching qualities).
    `-g 48 -keyint_min 48 -sc_threshold 0`,
    // HLS output config.
    `-f hls`,
    `-hls_time 6`,
    `-hls_playlist_type vod`,
    `-hls_list_size 0`,
    `-master_pl_name master.m3u8`,
    `-hls_segment_filename "${tmpDir}/%v/seg_%03d.ts"`,
    `-var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p v:3,a:3,name:240p"`,
    `"${tmpDir}/%v/playlist.m3u8"`,
  ].join(' ');
}

/**
 * Run a long ffmpeg invocation by spawning instead of execAsync —
 * execAsync buffers stderr in memory, which we'd OOM on a 2h encode
 * with `-loglevel info`. Spawn streams stderr directly to console;
 * we only resolve/reject on the exit code.
 */
function runFfmpeg(cmd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', () => undefined);
    proc.stderr?.on('data', (chunk) => {
      // Keep stderr visible in Cloud Logging but trimmed.
      const line = chunk.toString().trim();
      if (line) logger.info(`[hls/ffmpeg] ${line.slice(0, 500)}`);
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
 * Walk a local directory and upload every file under it to GCS at
 * `prefix/<relative-path>`. Concurrent up to `concurrency` to keep
 * a 2h video's ~1200 segments × 4 qualities = ~4800 files manageable
 * without saturating bandwidth.
 *
 * Cache headers: m3u8 = short cache (5 min) so updated manifests
 * propagate; .ts segments = immutable 1y (UUID-keyed paths).
 */
async function uploadDir(
  bucket: ReturnType<Storage['bucket']>,
  localDir: string,
  gcsPrefix: string,
  concurrency = 8
): Promise<number> {
  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(localDir);

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= files.length) return;
          const local = files[idx];
          const rel = path.relative(localDir, local).replace(/\\/g, '/');
          const dest = `${gcsPrefix}/${rel}`;
          const isManifest = local.endsWith('.m3u8');
          await bucket.upload(local, {
            destination: dest,
            metadata: {
              contentType: isManifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
              cacheControl: isManifest
                ? 'public, max-age=300'
                : 'public, max-age=31536000, immutable',
            },
          });
        }
      })()
    );
  }
  await Promise.all(workers);
  return files.length;
}

/**
 * POST /api/v1/internal/hls-ready — same auth pattern as the
 * faststart notify. Asks the API to broadcast `version:hls-ready`.
 */
async function notifyApiHlsReady(payload: {
  projectId: string;
  deliverableId: string;
  versionId: string;
  masterUrl: string;
}): Promise<void> {
  const baseUrl = config.internal.apiBaseUrl;
  const secret = config.internal.apiSecret;
  if (!baseUrl || !secret) {
    logger.warn('[hls] INTERNAL_API_BASE_URL or INTERNAL_API_SECRET missing, skipping notify');
    return;
  }

  const url = new URL('/api/v1/internal/hls-ready', baseUrl);
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
            reject(new Error(`API ${res.statusCode}: ${data.slice(0, 200)}`));
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

/**
 * Resolve the GCS path for the source video. Phase 1's faststart may
 * have already swapped Version.videoUrl to `_playable.mp4` — we
 * always want to encode from the ORIGINAL upload (no double-pass on
 * the already-remuxed file), so we strip the `_playable` suffix
 * before downloading.
 */
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
  // Strip _playable.mp4 → original extension. Both files live next
  // to each other; the original keeps its real container (.mp4 / .mov / ...).
  if (url.endsWith('_playable.mp4')) {
    // We don't know the original ext from the playable filename alone,
    // so fall back to the playable file itself for encoding (it's
    // valid mp4, just with moov-at-front — perfect input for ffmpeg).
    return url;
  }
  return url;
}

async function processHls(versionId: string): Promise<void> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    include: {
      deliverable: { include: { project: { select: { id: true } } } },
    },
  });
  if (!version) {
    logger.warn(`[hls] version ${versionId} not found`);
    return;
  }
  if (!version.videoUrl) {
    logger.warn(`[hls] version ${versionId} has no videoUrl`);
    return;
  }

  // Idempotence — skip if already encoded (covers Job retries on
  // success that don't matter).
  const altQ = (version.alternativeQualities as { master?: string } | null) || null;
  if (altQ?.master) {
    logger.info(`[hls] version ${versionId} already encoded, skipping`);
    return;
  }

  const gcsPath = gcsSourcePath(version.videoUrl);
  if (!gcsPath) {
    logger.warn(`[hls] cannot map ${version.videoUrl} to a GCS path`);
    return;
  }

  const ext = path.extname(gcsPath);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-'));
  const tmpInput = path.join(tmp, `in-${uuidv4()}${ext}`);
  const tmpOut = path.join(tmp, 'out');
  for (const q of ['1080p', '720p', '480p', '240p']) {
    await fs.mkdir(path.join(tmpOut, q), { recursive: true });
  }

  const storage = new Storage();
  const bucket = storage.bucket(config.media.bucketName);

  try {
    // 1. Download source.
    logger.info(`[hls] downloading gs://${config.media.bucketName}/${gcsPath}`);
    const dlStart = Date.now();
    await bucket.file(gcsPath).download({ destination: tmpInput });
    logger.info(`[hls] downloaded in ${Math.round((Date.now() - dlStart) / 1000)}s`);

    // 2. Probe — useful for the log line + future "skip variants
    // larger than source" optimisation.
    const meta = await probe(tmpInput);
    logger.info(`[hls] source ${meta.width}x${meta.height} dur=${Math.round(meta.duration)}s`);

    // 3. Encode.
    logger.info(`[hls] encoding 4 variants…`);
    const ffStart = Date.now();
    const cmd = buildFfmpegCommand(tmpInput, tmpOut);
    await runFfmpeg(cmd, 110 * 60 * 1000); // 110 min — Job timeout is 120
    logger.info(`[hls] encoded in ${Math.round((Date.now() - ffStart) / 1000)}s`);

    // 4. Upload everything under tmpOut/ to gs://bucket/hls/<uuid>/
    const versionFolder = `hls/${path.basename(gcsPath, ext).replace('_playable', '')}`;
    logger.info(`[hls] uploading to gs://${config.media.bucketName}/${versionFolder}/…`);
    const upStart = Date.now();
    const fileCount = await uploadDir(bucket, tmpOut, versionFolder, 12);
    logger.info(
      `[hls] uploaded ${fileCount} files in ${Math.round((Date.now() - upStart) / 1000)}s`
    );

    const masterUrl = `${config.media.publicBaseUrl}${versionFolder}/master.m3u8`;

    // 5. Update DB. Use upsert-style merge so we don't blow away
    // any other quality keys a future migration might add.
    await prisma.version.update({
      where: { id: versionId },
      data: {
        alternativeQualities: { ...(altQ || {}), master: masterUrl },
      },
    });

    // 6. Tell the API to broadcast.
    const projectId = version.deliverable?.project?.id;
    if (projectId) {
      await notifyApiHlsReady({
        projectId,
        deliverableId: version.deliverableId,
        versionId,
        masterUrl,
      }).catch((err) =>
        logger.warn(`[hls] notify failed for ${versionId}: ${(err as Error).message}`)
      );
    }

    logger.info(`[hls] ✅ done ${versionId} → ${versionFolder}/master.m3u8`);
  } finally {
    // Clean tmp — gen2 scratch is per-execution but explicit cleanup
    // helps when running locally for testing.
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const versionId = process.env.VERSION_ID;
  if (!versionId) {
    console.error('[hls] VERSION_ID env var required');
    process.exit(1);
  }
  try {
    await processHls(versionId);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error(`[hls] ❌ failed ${versionId}: ${(err as Error).message}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
}

void main();
