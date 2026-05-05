/**
 * Bictorys webhook handler.
 *
 * Public route (no JWT) — auth is the secret echoed in `X-Secret-Key`,
 * compared against `BICTORYS_WEBHOOK_SECRET`. The route in app.ts mounts
 * `express.raw({ type: 'application/json' })` so we still receive the raw
 * bytes; we parse manually after the secret check (no HMAC, but keeping
 * raw lets us safely log payloads if needed).
 *
 * Bictorys payload is FLAT — `{ id, paymentReference, status, pspName, ... }`,
 * not enveloped in `{ event, data }`. The state transition is conveyed by
 * the lowercase `status` field. See bictorysService.ts for the full shape.
 *
 * This handler is the FAST PATH. The polling endpoint in controllers/index.ts
 * does the same DB work via `finalizePayment` helpers when Bictorys' webhook
 * delivery is delayed/unavailable (sandbox often skips it). Whichever path
 * runs first wins — the helpers are idempotent.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { bictorysService, BictorysWebhookPayload } from '../../../services/bictorysService';
import { logger } from '../../../utils/logger';
import {
  finalizePaymentSucceeded,
  finalizePaymentFailed,
} from '../services/finalizePayment';

export const handleBictorysWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
    const headerSecret = (req.headers['x-secret-key'] || req.headers['X-Secret-Key']) as
      | string
      | undefined;

    if (!bictorysService.verifyWebhookSecret(headerSecret)) {
      logger.warn('[bictorys-webhook] secret verification failed');
      // 401 not 403 — the request is unauthenticated, not forbidden.
      res.status(401).json({ error: 'Invalid secret' });
      return;
    }

    let payload: BictorysWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as BictorysWebhookPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }

    if (!payload?.id || !payload?.paymentReference) {
      res.status(400).json({ error: 'Missing id or paymentReference' });
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { paymentReference: payload.paymentReference },
      include: { subscription: true },
    });
    if (!payment) {
      logger.warn(`[bictorys-webhook] no payment for reference ${payload.paymentReference}`);
      // 200 so Bictorys doesn't retry forever for a row we don't have.
      res.status(200).json({ received: true, note: 'no matching payment' });
      return;
    }

    const sub = payment.subscription;
    const now = new Date();
    // Normalise — Bictorys docs say lowercase but we've also seen
    // `SUCCEEDED` in some sandbox payloads, so be permissive.
    const status = (payload.status || '').toLowerCase();
    const isSuccess = status === 'succeeded' || status === 'success' || status === 'authorized';
    const isFailure = status === 'failed' || status === 'cancelled' || status === 'rejected';
    const isPending = status === 'pending' || status === 'processing';

    if (isSuccess) {
      const activated = await finalizePaymentSucceeded({
        paymentId: payment.id,
        subscriptionId: sub.id,
        organizationId: sub.organizationId,
        billingCycle: sub.billingCycle,
        bictorysChargeId: payload.id,
        paymentMethod: payload.pspName ?? null,
        observedAt: now,
      });
      if (activated) {
        logger.info(
          `[bictorys-webhook] paid: org=${sub.organizationId} sub=${sub.id} amount=${payment.amount} ${payment.currency} via=${payload.pspName ?? 'n/a'}`
        );
      }
      res.status(200).json({ received: true, activated });
      return;
    }

    if (isFailure) {
      const marked = await finalizePaymentFailed({
        paymentId: payment.id,
        bictorysChargeId: payload.id,
        failureReason: payload.failureReason ?? status,
        observedAt: now,
      });
      if (marked) {
        logger.info(
          `[bictorys-webhook] failed: payment=${payment.id} reason=${payload.failureReason ?? status}`
        );
      }
      res.status(200).json({ received: true, marked });
      return;
    }

    if (isPending) {
      // Just record we heard from Bictorys; don't change status.
      await prisma.payment.update({
        where: { id: payment.id },
        data: { webhookReceivedAt: now, bictorysChargeId: payload.id },
      });
      res.status(200).json({ received: true });
      return;
    }

    // Unknown status — log and ack so Bictorys doesn't retry forever.
    logger.warn(`[bictorys-webhook] unknown status: ${payload.status}`);
    res.status(200).json({ received: true, note: 'unknown status' });
  } catch (err) {
    next(err);
  }
};
