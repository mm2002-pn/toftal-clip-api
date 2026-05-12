/**
 * Admin backfill for the video processing pipelines.
 *
 * Re-runs Phase 1 (faststart) or Phase 2 (HLS multi-quality) on
 * versions that predate the pipeline rollout. The Cloud Run Jobs are
 * idempotent (each worker checks `_playable.mp4` suffix or
 * `alternativeQualities.master` and skips), so this is safe to re-run
 * even on rows that already migrated.
 *
 * Workflow
 * ────────
 *  1. GET  /admin/videos/backfill-status       → counts pending / done
 *  2. POST /admin/videos/backfill-faststart    → enqueue all missing
 *     POST /admin/videos/backfill-hls          → ↑ idem for HLS
 *
 * The POST endpoints respond immediately with the count enqueued and
 * run the trigger loop in `setImmediate` with a throttle (15 s for
 * faststart, 60 s for HLS — HLS is full re-encode, much heavier). At
 * <60 versions this fully drains in 15-60 min.
 *
 * Audit log captures who triggered the backfill, the count of versions
 * affected, and the type. Each individual job's outcome is logged by
 * its own worker (see workers/faststart.ts and workers/hls.ts).
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';
import { logger } from '../../../utils/logger';
import { triggerFaststartJob } from '../../../services/faststartTrigger';
import { triggerHlsJob } from '../../../services/hlsTrigger';

const PLAYABLE_SUFFIX = '_playable.mp4';
// Stagger triggers so we don't fan out hundreds of Cloud Run Job
// executions in the same second. Faststart is cheap (~30 s); HLS is
// expensive (5-30 min) so we space those out further.
const FASTSTART_THROTTLE_MS = 15_000;
const HLS_THROTTLE_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Find versions that still need a faststart pass — `videoUrl` is set
 * but doesn't end in the `_playable.mp4` suffix the worker writes.
 */
async function findFaststartCandidates(): Promise<string[]> {
  const rows = await prisma.version.findMany({
    where: {
      NOT: { videoUrl: { endsWith: PLAYABLE_SUFFIX } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Find versions that still need an HLS encode — `alternativeQualities`
 * is null OR doesn't have a `master` key. Prisma's JSON filters can't
 * easily express "key absent", so we fetch + filter in JS. Cheap at
 * the volumes this admin tool runs against.
 */
async function findHlsCandidates(): Promise<string[]> {
  const rows = await prisma.version.findMany({
    select: { id: true, alternativeQualities: true },
  });
  return rows
    .filter((r) => !(r.alternativeQualities as { master?: string } | null)?.master)
    .map((r) => r.id);
}

/**
 * GET /api/v1/admin/videos/backfill-status
 *
 * Cheap count endpoint so the admin UI can render "X faststart pending,
 * Y HLS pending" badges without enqueuing anything.
 */
export const getBackfillStatus = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [faststart, hls] = await Promise.all([
      findFaststartCandidates(),
      findHlsCandidates(),
    ]);
    ApiResponse.success(res, {
      faststartPending: faststart.length,
      hlsPending: hls.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/admin/videos/backfill-faststart?dryRun=1
 *
 * Enqueues a faststart Cloud Run Job execution for every version that
 * still needs one. Returns immediately with the count; the actual loop
 * runs in `setImmediate` so the admin doesn't wait on a 15-min HTTP
 * request that would time out anyway.
 */
export const backfillFaststart = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const ids = await findFaststartCandidates();

    auditLogFromRequest(req, 'VIDEO_BACKFILL_FASTSTART' as any, {
      targetType: 'system' as any,
      metadata: { count: ids.length, dryRun },
    });

    if (dryRun) {
      ApiResponse.success(
        res,
        { enqueued: 0, candidates: ids.length, dryRun: true },
        `Dry run — ${ids.length} versions would be enqueued`
      );
      return;
    }

    // Respond now; loop runs detached.
    ApiResponse.success(
      res,
      { enqueued: ids.length, throttleMs: FASTSTART_THROTTLE_MS },
      `Faststart backfill started (${ids.length} versions, ~${Math.round(
        (ids.length * FASTSTART_THROTTLE_MS) / 60_000
      )} min)`
    );

    setImmediate(async () => {
      logger.info(`[backfill-faststart] starting loop on ${ids.length} versions`);
      for (let i = 0; i < ids.length; i++) {
        await triggerFaststartJob(ids[i]);
        logger.info(
          `[backfill-faststart] enqueued ${i + 1}/${ids.length} (${ids[i]})`
        );
        if (i < ids.length - 1) await sleep(FASTSTART_THROTTLE_MS);
      }
      logger.info(`[backfill-faststart] done — ${ids.length} enqueued`);
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/admin/videos/backfill-hls?dryRun=1
 *
 * Same as faststart but for the HLS encode pipeline. Heavier per job
 * so the throttle is wider.
 */
export const backfillHls = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const ids = await findHlsCandidates();

    auditLogFromRequest(req, 'VIDEO_BACKFILL_HLS' as any, {
      targetType: 'system' as any,
      metadata: { count: ids.length, dryRun },
    });

    if (dryRun) {
      ApiResponse.success(
        res,
        { enqueued: 0, candidates: ids.length, dryRun: true },
        `Dry run — ${ids.length} versions would be enqueued`
      );
      return;
    }

    ApiResponse.success(
      res,
      { enqueued: ids.length, throttleMs: HLS_THROTTLE_MS },
      `HLS backfill started (${ids.length} versions, ~${Math.round(
        (ids.length * HLS_THROTTLE_MS) / 60_000
      )} min to enqueue)`
    );

    setImmediate(async () => {
      logger.info(`[backfill-hls] starting loop on ${ids.length} versions`);
      for (let i = 0; i < ids.length; i++) {
        await triggerHlsJob(ids[i]);
        logger.info(
          `[backfill-hls] enqueued ${i + 1}/${ids.length} (${ids[i]})`
        );
        if (i < ids.length - 1) await sleep(HLS_THROTTLE_MS);
      }
      logger.info(`[backfill-hls] done — ${ids.length} enqueued`);
    });
  } catch (err) {
    next(err);
  }
};
