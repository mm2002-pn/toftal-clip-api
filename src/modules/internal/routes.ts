/**
 * Internal service-to-service endpoints.
 *
 * Auth model: NO JWT. Each endpoint validates a shared secret in the
 * `X-Internal-Secret` header against `config.internal.apiSecret`.
 * Timing-safe compare to avoid leaking the secret through response-
 * time differences.
 *
 * Why these exist
 * ───────────────
 * The faststart worker is a Cloud Run Job — a separate Node process
 * with no access to the API's in-memory Socket.IO instance. When the
 * remux finishes, the Job needs the API to broadcast `version:playback-
 * ready` to the project room so any open client swaps `<video src>`
 * without a page reload. The Job POSTs here, the API re-emits.
 *
 * Same pattern works for any future cross-process notify (transcoding
 * progress in Phase 2, batch jobs, etc.). Keep it tightly scoped — every
 * endpoint here is a privileged escape hatch, not a public API.
 */

import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { socketService } from '../../services/socketService';
import { logger } from '../../utils/logger';

const router = Router();

function verifyInternalSecret(headerSecret: string | undefined): boolean {
  const expected = config.internal.apiSecret;
  if (!headerSecret || !expected) return false;
  const a = Buffer.from(headerSecret, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * POST /api/v1/internal/version-ready
 * Headers: X-Internal-Secret: <shared secret>
 * Body: { projectId, deliverableId, versionId, videoUrl }
 *
 * Re-emits `version:playback-ready` to the project's Socket.IO room so
 * connected clients update their `<video src>` instantly.
 */
router.post('/version-ready', (req: Request, res: Response): void => {
  const headerSecret = (req.headers['x-internal-secret'] || req.headers['X-Internal-Secret']) as
    | string
    | undefined;

  if (!verifyInternalSecret(headerSecret)) {
    logger.warn('[internal] version-ready: invalid secret');
    res.status(401).json({ error: 'Invalid internal secret' });
    return;
  }

  const { projectId, deliverableId, versionId, videoUrl } = (req.body || {}) as {
    projectId?: string;
    deliverableId?: string;
    versionId?: string;
    videoUrl?: string;
  };

  if (!projectId || !deliverableId || !versionId || !videoUrl) {
    res.status(400).json({ error: 'Missing fields: projectId, deliverableId, versionId, videoUrl' });
    return;
  }

  try {
    socketService.emitToProject(projectId, 'version:playback-ready' as any, {
      versionId,
      deliverableId,
      videoUrl,
    } as any);
    logger.info(`[internal] re-emitted version:playback-ready for ${versionId}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`[internal] socket emit failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Emit failed' });
  }
});

/**
 * POST /api/v1/internal/hls-ready
 * Headers: X-Internal-Secret: <shared secret>
 * Body: { projectId, deliverableId, versionId, masterUrl }
 *
 * Re-emits `version:hls-ready` so connected clients can switch to
 * adaptive bitrate playback (hls.js / native HLS) without refreshing.
 */
router.post('/hls-ready', (req: Request, res: Response): void => {
  const headerSecret = (req.headers['x-internal-secret'] || req.headers['X-Internal-Secret']) as
    | string
    | undefined;

  if (!verifyInternalSecret(headerSecret)) {
    logger.warn('[internal] hls-ready: invalid secret');
    res.status(401).json({ error: 'Invalid internal secret' });
    return;
  }

  const { projectId, deliverableId, versionId, masterUrl } = (req.body || {}) as {
    projectId?: string;
    deliverableId?: string;
    versionId?: string;
    masterUrl?: string;
  };

  if (!projectId || !deliverableId || !versionId || !masterUrl) {
    res.status(400).json({
      error: 'Missing fields: projectId, deliverableId, versionId, masterUrl',
    });
    return;
  }

  try {
    socketService.emitToProject(projectId, 'version:hls-ready' as any, {
      versionId,
      deliverableId,
      masterUrl,
    } as any);
    logger.info(`[internal] re-emitted version:hls-ready for ${versionId}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`[internal] socket emit failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Emit failed' });
  }
});

export default router;
