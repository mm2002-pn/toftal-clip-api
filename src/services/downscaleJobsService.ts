/**
 * Async downscale orchestration.
 *
 * The HTTP `/downscale` endpoint used to fork ffmpeg synchronously and
 * wait — fine for short videos, fatal for anything > a few minutes
 * because Cloud Run kills the request at its timeout. This service
 * moves the actual work into a Cloud Run Job and uses
 * `version_downscale_jobs` as a coordination table.
 *
 * Contract:
 *   - `enqueue(versionId, quality)` is idempotent and concurrency-safe.
 *     N callers racing for the same (version, quality) only ever spawn
 *     ONE Cloud Run Job; the others get the existing job's status back.
 *   - The worker (`src/scripts/downscale-version.ts`) flips the row to
 *     DONE or FAILED and is the ONLY writer for those terminal states.
 *   - A separate sweeper job recycles PROCESSING rows older than 1 h
 *     (Cloud Run could've killed the worker between the row insert and
 *     the terminal update — without the sweeper the row stays stuck).
 */

import { JobsClient } from '@google-cloud/run';
import { prisma } from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';
import { BUCKET_NAME, getSignedDownloadUrl } from '../config/gcs';

/**
 * Replace a public CDN URL like
 *   https://media.staging.toftalclip.io/videos/<uuid>.mp4
 * (or https://storage.googleapis.com/<bucket>/videos/<uuid>.mp4)
 * with a freshly-signed GCS URL that bakes in CD: attachment +
 * application/octet-stream via response-header overrides.
 *
 * Why we do this even for files that *should* already carry those
 * headers in their stored metadata: older downscale runs (before the
 * Content-Disposition fix landed) uploaded with `video/mp4` and no
 * CD, which on iOS Safari opens the player inline instead of saving.
 * Signing on the fly applies the override regardless of what the
 * object's stored metadata says, so old cached files and new ones
 * behave the same — Safari sees `attachment` + `octet-stream` in the
 * response and routes the body to its download manager.
 *
 * Returns the original URL on any failure (best-effort).
 */
async function signedDownloadForCachedUrl(
  cachedUrl: string,
  quality: string
): Promise<string> {
  try {
    const u = new URL(cachedUrl);
    let objectName = u.pathname.replace(/^\/+/, '');
    if (objectName.startsWith(`${BUCKET_NAME}/`)) {
      objectName = objectName.slice(BUCKET_NAME.length + 1);
    }
    const filename = `video_${quality}.mp4`;
    return await getSignedDownloadUrl(objectName, filename, 60);
  } catch (err) {
    logger.warn(
      `[downscale-jobs] could not sign download URL for ${cachedUrl}: ${(err as Error).message}`
    );
    return cachedUrl;
  }
}

export type DownscaleJobStatus = 'PROCESSING' | 'DONE' | 'FAILED';

export interface DownscaleJobView {
  status: DownscaleJobStatus;
  /** Final downscaled URL — only set when status === 'DONE'. */
  url?: string;
  /** Wrapped ffmpeg / upload error — only set when status === 'FAILED'. */
  error?: string;
  /** Internal job row id. Returned so the client can correlate logs. */
  jobId: string;
}

export const SUPPORTED_QUALITIES = ['SD', '720p', '1080p', '2K', '4K'] as const;
export type SupportedQuality = (typeof SUPPORTED_QUALITIES)[number];

let _client: JobsClient | null = null;
function getJobsClient(): JobsClient {
  if (!_client) _client = new JobsClient();
  return _client;
}

function jobPath(): string {
  return `projects/${config.gcp.projectId}/locations/${config.gcp.region}/jobs/${config.gcp.downscaleJobName}`;
}

/**
 * Best-effort Cloud Run Job execution kick-off. Logs and swallows
 * failures — the row stays PROCESSING and the sweeper picks it up if
 * the Job never actually ran. We DON'T rollback the row insert: that
 * would re-open the dedup race we just closed.
 */
async function triggerJob(
  versionId: string,
  quality: string,
  dbJobId: string
): Promise<string | undefined> {
  if (!config.gcp.projectId) {
    logger.info(
      `[downscale-jobs] dev mode — skipped Cloud Run invocation for ${versionId}/${quality} (job row ${dbJobId})`
    );
    return undefined;
  }

  try {
    const [operation] = await getJobsClient().runJob({
      name: jobPath(),
      overrides: {
        containerOverrides: [
          {
            // Worker reads these to know what to process. We also pass
            // the DB row id so the worker can update *that specific*
            // row even if another job got enqueued in the meantime.
            env: [
              { name: 'VERSION_ID', value: versionId },
              { name: 'QUALITY', value: quality },
              { name: 'JOB_ROW_ID', value: dbJobId },
            ],
          },
        ],
      },
    });
    const executionId = operation?.name ?? undefined;
    logger.info(
      `[downscale-jobs] enqueued ${versionId}/${quality} (row ${dbJobId}, exec ${executionId})`
    );
    return executionId;
  } catch (err) {
    logger.error(
      `[downscale-jobs] failed to enqueue Cloud Run Job for ${versionId}/${quality}: ${
        (err as Error).message
      }`
    );
    return undefined;
  }
}

/**
 * Read-only helper. Returns null if no job has ever been enqueued for
 * this (version, quality) pair AND the cached URL doesn't exist in
 * Version.alternativeQualities either.
 */
export async function getDownscaleStatus(
  versionId: string,
  quality: string
): Promise<DownscaleJobView | null> {
  // Cheap path: if Version.alternativeQualities already has the URL we
  // don't even need to read the jobs table.
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { alternativeQualities: true },
  });
  const cached =
    version?.alternativeQualities && typeof version.alternativeQualities === 'object'
      ? (version.alternativeQualities as Record<string, string>)[quality]
      : undefined;
  if (cached) {
    const signedUrl = await signedDownloadForCachedUrl(cached, quality);
    return { status: 'DONE', url: signedUrl, jobId: 'cached' };
  }

  const job = await prisma.versionDownscaleJob.findUnique({
    where: { version_quality_unique: { versionId, quality } },
  });
  if (!job) return null;
  const url =
    job.status === 'DONE' && job.resultUrl
      ? await signedDownloadForCachedUrl(job.resultUrl, quality)
      : job.resultUrl ?? undefined;
  return {
    status: job.status as DownscaleJobStatus,
    url,
    error: job.error ?? undefined,
    jobId: job.id,
  };
}

interface EnqueueOptions {
  /** When true, a FAILED row is reset to PROCESSING and a new Job runs. */
  retry?: boolean;
}

/**
 * Atomically dedup'd enqueue. The createMany+skipDuplicates pattern is
 * how Prisma exposes Postgres' `INSERT … ON CONFLICT DO NOTHING`. The
 * `count` it returns tells us whether OUR call won the race.
 *
 *   - count === 1 → we inserted the row, we trigger the Job.
 *   - count === 0 → another caller got there first; we read their row
 *                   and return its current status. The worker they
 *                   triggered will do the work for everyone.
 */
export async function enqueueDownscale(
  versionId: string,
  quality: string,
  opts: EnqueueOptions = {}
): Promise<DownscaleJobView> {
  // Fast-path the cached URL so a retry= request doesn't pointlessly
  // reset a row that has the URL stored in alternativeQualities.
  const cached = await getDownscaleStatus(versionId, quality);
  if (cached && cached.status === 'DONE') return cached;

  if (cached && cached.status === 'FAILED' && opts.retry) {
    // Atomic reset to PROCESSING — the WHERE clause keeps us from
    // racing with a concurrent retry that also wants to flip the row.
    const reset = await prisma.versionDownscaleJob.updateMany({
      where: { id: cached.jobId, status: 'FAILED' },
      data: {
        status: 'PROCESSING',
        error: null,
        resultUrl: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    });
    if (reset.count === 1) {
      const exec = await triggerJob(versionId, quality, cached.jobId);
      if (exec) {
        await prisma.versionDownscaleJob.update({
          where: { id: cached.jobId },
          data: { cloudRunExecutionId: exec },
        });
      }
    }
    // Whether we won the reset race or not, read back the current state.
    const after = await getDownscaleStatus(versionId, quality);
    return after ?? { status: 'PROCESSING', jobId: cached.jobId };
  }

  if (cached && cached.status !== 'DONE') return cached;

  // No row yet — race to insert.
  const created = await prisma.versionDownscaleJob.createMany({
    data: [{ versionId, quality, status: 'PROCESSING' }],
    skipDuplicates: true,
  });

  if (created.count === 0) {
    // Another caller inserted between our read and our insert. Re-read.
    const after = await getDownscaleStatus(versionId, quality);
    return after ?? { status: 'PROCESSING', jobId: 'unknown' };
  }

  // We won the race. Fetch our row id then kick off the Job.
  const row = await prisma.versionDownscaleJob.findUnique({
    where: { version_quality_unique: { versionId, quality } },
    select: { id: true },
  });
  if (!row) {
    // Shouldn't happen — we literally just inserted. Defensive.
    return { status: 'PROCESSING', jobId: 'unknown' };
  }

  const exec = await triggerJob(versionId, quality, row.id);
  if (exec) {
    await prisma.versionDownscaleJob.update({
      where: { id: row.id },
      data: { cloudRunExecutionId: exec },
    });
  }
  return { status: 'PROCESSING', jobId: row.id };
}

/**
 * Marks PROCESSING rows that started >`maxAgeMs` ago as FAILED. Called
 * by the sweeper Cloud Run Job. Returns the number of rows recycled.
 */
export async function sweepStuckJobs(maxAgeMs: number = 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const updated = await prisma.versionDownscaleJob.updateMany({
    where: { status: 'PROCESSING', startedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      error: 'Worker did not finish in time (zombie — recycled by sweeper)',
      finishedAt: new Date(),
    },
  });
  if (updated.count > 0) {
    logger.warn(`[downscale-jobs] sweeper recycled ${updated.count} stuck job(s)`);
  }
  return updated.count;
}
