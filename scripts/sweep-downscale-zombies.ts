/**
 * Cloud Run Job — recycles stuck PROCESSING downscale rows.
 *
 * The dedup story relies on the assumption that PROCESSING is always
 * truthful: if the row says PROCESSING, a worker is making progress.
 * But Cloud Run can SIGKILL a Job between the row insert and the
 * worker's terminal update (instance reschedule, OOM, ffmpeg crash that
 * doesn't reach our catch, …). Without intervention the row would stay
 * PROCESSING forever and block any retry.
 *
 * This Job runs every 5 min on Cloud Scheduler and flips any
 * PROCESSING row older than 1 h to FAILED. A 1-h watermark is wider
 * than the worst-case downscale (the longest sources in the wild +
 * ffmpeg's 50-min internal timeout) so we never mis-recycle a live job.
 *
 * After this Job runs, the front's normal "retry" flow will re-enqueue
 * a fresh worker — operators don't need to do anything manual.
 */

import { sweepStuckJobs } from '../src/services/downscaleJobsService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[downscale-sweeper] starting');
  const count = await sweepStuckJobs();
  console.log(`[downscale-sweeper] recycled ${count} row(s)`);
}

main()
  .catch((err) => {
    console.error('[downscale-sweeper] fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
