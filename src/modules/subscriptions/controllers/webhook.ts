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
 * Idempotence: keyed on Payment.status. A duplicate `succeeded` for a row
 * already in SUCCEEDED is a no-op (200) so Bictorys' retry policy doesn't
 * thrash us.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { bictorysService, BictorysWebhookPayload } from '../../../services/bictorysService';
import { logger } from '../../../utils/logger';

/**
 * Compute the period boundaries for a Subscription that just became active.
 * MONTHLY rolls forward 1 month, YEARLY rolls forward 1 year. Stored UTC;
 * the frontend handles the user's timezone for display.
 */
function computePeriod(now: Date, cycle: 'MONTHLY' | 'YEARLY') {
  const end = new Date(now);
  if (cycle === 'MONTHLY') {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return { start: now, end, nextBillingAt: end };
}

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

    // Idempotence guard: if we already finalised this payment, stop here.
    if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
      res.status(200).json({ received: true, note: 'already processed' });
      return;
    }

    const sub = payment.subscription;
    // Normalise — Bictorys docs say lowercase but we've also seen
    // `SUCCEEDED` in some sandbox payloads, so be permissive.
    const status = (payload.status || '').toLowerCase();
    const isSuccess = status === 'succeeded' || status === 'success' || status === 'authorized';
    const isFailure = status === 'failed' || status === 'cancelled' || status === 'rejected';
    const isPending = status === 'pending' || status === 'processing';

    if (isSuccess) {
      // Finalise: mark Payment SUCCEEDED, Subscription ACTIVE, Org ACTIVE,
      // compute period boundaries. Single transaction so a partial failure
      // (e.g. Org update fails) rolls back the Payment update — we'd rather
      // get retried than leave the system in a half-paid state.
      const now = new Date();
      const { start, end, nextBillingAt } = computePeriod(now, sub.billingCycle);

      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCEEDED',
            processedAt: now,
            webhookReceivedAt: now,
            bictorysChargeId: payload.id,
            paymentMethod: payload.pspName ?? null,
          },
        }),
        prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: start,
            currentPeriodEnd: end,
            nextBillingAt,
          },
        }),
        prisma.organization.update({
          where: { id: sub.organizationId },
          data: { status: 'ACTIVE' },
        }),
      ]);

      logger.info(
        `[bictorys-webhook] paid: org=${sub.organizationId} sub=${sub.id} amount=${payment.amount} ${payment.currency} via=${payload.pspName ?? 'n/a'}`
      );

      res.status(200).json({ received: true });
      return;
    }

    if (isFailure) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          webhookReceivedAt: new Date(),
          bictorysChargeId: payload.id,
          failureReason: payload.failureReason ?? status,
        },
      });
      // Subscription stays PENDING_PAYMENT — the user can retry by going
      // through checkout again (which generates a fresh paymentReference).
      logger.info(
        `[bictorys-webhook] failed: payment=${payment.id} reason=${payload.failureReason ?? status}`
      );
      res.status(200).json({ received: true });
      return;
    }

    if (isPending) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { webhookReceivedAt: new Date(), bictorysChargeId: payload.id },
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
