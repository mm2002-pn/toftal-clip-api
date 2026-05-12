/**
 * Cloud Run Job worker — downscale ONE Version to ONE target quality.
 *
 * Triggered by `downscaleJobsService.enqueueDownscale()` via
 * `JobsClient.runJob()` with env overrides:
 *   - VERSION_ID    UUID of versions.id
 *   - QUALITY       '720p' | '1080p' | '2K' | '4K' | 'SD'
 *   - JOB_ROW_ID    UUID of the version_downscale_jobs row this run owns
 *
 * Lifecycle for the row this run owns:
 *   PROCESSING (set on insert by the API) → DONE | FAILED (set here).
 *
 * On crash mid-run the row stays PROCESSING and the sweeper recycles it
 * to FAILED after the deadline. We DON'T touch the row from anywhere
 * except this script and the sweeper.
 */

import { PrismaClient } from '@prisma/client';
import {
  downscaleAndUploadVideo,
  remuxHlsVariantToMp4,
} from '../src/services/VideoMetadataService';

const prisma = new PrismaClient();

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[downscale-worker] missing env ${name} — aborting`);
    process.exit(2);
  }
  return v;
}

async function markFailed(jobRowId: string, msg: string) {
  try {
    await prisma.versionDownscaleJob.update({
      where: { id: jobRowId },
      data: {
        status: 'FAILED',
        error: msg.slice(0, 2000),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(
      `[downscale-worker] could not mark row ${jobRowId} FAILED: ${(err as Error).message}`
    );
  }
}

async function main() {
  const versionId = reqEnv('VERSION_ID');
  const quality = reqEnv('QUALITY');
  const jobRowId = reqEnv('JOB_ROW_ID');

  console.log(`[downscale-worker] start version=${versionId} quality=${quality} row=${jobRowId}`);

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { id: true, videoUrl: true, metadata: true, alternativeQualities: true },
  });

  if (!version) {
    await markFailed(jobRowId, `Version ${versionId} not found`);
    process.exit(1);
  }

  // Belt-and-braces: another worker may have populated the URL between
  // enqueue and now. Honour it and short-circuit.
  const existing =
    version.alternativeQualities && typeof version.alternativeQualities === 'object'
      ? (version.alternativeQualities as Record<string, string>)[quality]
      : undefined;
  if (existing) {
    console.log(`[downscale-worker] ${quality} already present, marking DONE without re-encode`);
    await prisma.versionDownscaleJob.update({
      where: { id: jobRowId },
      data: {
        status: 'DONE',
        resultUrl: existing,
        finishedAt: new Date(),
      },
    });
    return;
  }

  let metadata = version.metadata as Record<string, unknown> | null;
  if (!metadata) {
    // The downscaler needs metadata to be sane. Pull it lazily.
    const { extractVideoMetadata } = await import('../src/services/VideoMetadataService');
    console.log(`[downscale-worker] extracting metadata for ${versionId}`);
    metadata = await extractVideoMetadata(version.videoUrl);
    await prisma.version.update({
      where: { id: versionId },
      data: { metadata: metadata as object },
    });
  }

  try {
    // Fast path: if the HLS ladder already encoded this quality at
    // upload time, just remux the TS segments to MP4 (no re-encode →
    // ~30 s vs ~4 min). Returns null when HLS is unavailable for this
    // quality, in which case we fall through to the full encode.
    const hlsMasterUrl =
      version.alternativeQualities &&
      typeof version.alternativeQualities === 'object' &&
      typeof (version.alternativeQualities as Record<string, string>).master === 'string'
        ? (version.alternativeQualities as Record<string, string>).master
        : null;

    let url: string | null = null;
    if (hlsMasterUrl) {
      console.log(`[downscale-worker] trying HLS remux for ${quality}`);
      url = await remuxHlsVariantToMp4(hlsMasterUrl, quality);
    }

    if (!url) {
      console.log(`[downscale-worker] full ffmpeg encode → ${quality}`);
      url = await downscaleAndUploadVideo(version.videoUrl, quality, metadata as never);
    }

    // Single transaction: mirror the URL into Version.alternativeQualities
    // (cheap read for status) AND flip the job row to DONE. If either
    // write fails the other rolls back — we don't want a DONE row with
    // no mirrored URL or vice-versa.
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.version.findUnique({
        where: { id: versionId },
        select: { alternativeQualities: true },
      });
      const merged: Record<string, string> = {
        ...((fresh?.alternativeQualities as Record<string, string> | null) ?? {}),
        [quality]: url,
      };
      await tx.version.update({
        where: { id: versionId },
        data: { alternativeQualities: merged },
      });
      await tx.versionDownscaleJob.update({
        where: { id: jobRowId },
        data: { status: 'DONE', resultUrl: url, finishedAt: new Date() },
      });
    });

    console.log(`[downscale-worker] DONE ${versionId}/${quality} → ${url}`);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[downscale-worker] FAILED ${versionId}/${quality}: ${msg}`);
    await markFailed(jobRowId, msg);
    process.exit(1);
  }
}

main()
  .catch(async (err) => {
    console.error('[downscale-worker] unhandled error:', err);
    // Best-effort terminal state — main() already handled the typical
    // path, this is for crashes before main()'s try/catch.
    const rowId = process.env.JOB_ROW_ID;
    if (rowId) await markFailed(rowId, (err as Error).message ?? 'unknown error');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
