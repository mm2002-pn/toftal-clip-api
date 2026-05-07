/**
 * Bictorys webhook handler.
 *
 * Public route (no JWT) — auth via two methods, in order of preference:
 *   1. HMAC-SHA256 signature in `X-Webhook-Signature` + replay-protected
 *      timestamp in `X-Webhook-Timestamp` (5 min window).
 *   2. Static `X-Secret-Key` echo of the configured webhook secret.
 *
 * The route in app.ts mounts `express.raw({ type: 'application/json' })`
 * so we receive the raw bytes (mandatory for HMAC verification).
 *
 * Bictorys payload is FLAT — `{ id, paymentReference, status, pspName,
 * amount, currency, ... }`, not enveloped in `{ event, data }`. The state
 * transition is conveyed by the lowercase `status` field. See
 * bictorysService.ts for the full shape.
 *
 * Anti-fraud (per Bictorys integration guide §6): we cross-check the
 * webhook's `amount` and `currency` against the Payment row we look up
 * via `paymentReference`. Mismatch = log + skip activation. Without
 * this check, an attacker who got hold of a valid webhook + secret
 * could trigger an activation for a different (cheaper) charge.
 *
 * Idempotence is handled by `finalizePayment*` helpers — re-deliveries
 * of an already-processed webhook are no-ops. We always return 200 so
 * Bictorys doesn't retry forever (per their guide, retry on non-2xx).
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
    const headerSignature = (req.headers['x-webhook-signature'] ||
      req.headers['X-Webhook-Signature']) as string | undefined;
    const headerTimestamp = (req.headers['x-webhook-timestamp'] ||
      req.headers['X-Webhook-Timestamp']) as string | undefined;

    if (
      !bictorysService.verifyWebhook({
        rawBody,
        headerSecret,
        headerSignature,
        headerTimestamp,
      })
    ) {
      logger.warn(
        `[bictorys-webhook] auth failed (hmac=${!!headerSignature} static=${!!headerSecret})`
      );
      // Per the Bictorys guide we should still 200 to avoid their retry
      // storm — but a hard 401 surfaces config issues faster in dev/staging.
      // Keep 401 here; once stable in prod we may switch to 200+log-only.
      res.status(401).json({ error: 'Invalid signature' });
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

    // Anti-fraud: cross-check amount + currency against the Payment row.
    // Skip when the webhook doesn't ship those fields (some pending/
    // metadata-only events). On mismatch, log + ack 200 + DO NOT activate.
    if (typeof payload.amount === 'number' && payload.amount !== payment.amount) {
      logger.warn(
        `[bictorys-webhook] AMOUNT MISMATCH: ref=${payload.paymentReference} expected=${payment.amount} got=${payload.amount}`
      );
      res.status(200).json({ received: true, note: 'amount mismatch' });
      return;
    }
    if (
      typeof payload.currency === 'string' &&
      payload.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      logger.warn(
        `[bictorys-webhook] CURRENCY MISMATCH: ref=${payload.paymentReference} expected=${payment.currency} got=${payload.currency}`
      );
      res.status(200).json({ received: true, note: 'currency mismatch' });
      return;
    }

    const sub = payment.subscription;
    const now = new Date();
    // Normalise — Bictorys docs say lowercase but we've also seen
    // `SUCCEEDED` in some sandbox payloads, so be permissive.
    // Per their guide, `authorized` ≈ paid (card pre-capture); treat as
    // success. `reversed` is a refund-after-success → terminal failure
    // for the activation flow.
    const status = (payload.status || '').toLowerCase();
    const isSuccess = status === 'succeeded' || status === 'success' || status === 'authorized';
    const isFailure =
      status === 'failed' || status === 'cancelled' || status === 'rejected' || status === 'reversed';
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
