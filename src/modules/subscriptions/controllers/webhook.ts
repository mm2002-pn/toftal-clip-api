/**
 * Bictorys webhook handler.
 *
 * Public route (no JWT) — auth is the HMAC signature on the raw body. Any
 * route mounted here MUST receive the raw body buffer; the `bictorysWebhook`
 * route in app.ts uses `express.raw({ type: 'application/json' })` to skip
 * the JSON middleware. We parse manually after signature verification.
 *
 * Idempotence: keyed on `bictorysChargeId`. Bictorys retries on any non-2xx,
 * so a duplicate `charge.successful` for an already-completed payment is a
 * no-op (returns 200).
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
    const signature = (req.headers['x-bictorys-signature'] || req.headers['X-Bictorys-Signature']) as
      | string
      | undefined;

    if (!bictorysService.verifyWebhookSignature(rawBody, signature)) {
      logger.warn('[bictorys-webhook] signature verification failed');
      // 401 not 403 — the request is unauthenticated, not forbidden.
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

    const event = payload.event;
    const data = payload.data;
    if (!data?.chargeId || !data?.paymentReference) {
      res.status(400).json({ error: 'Missing chargeId or paymentReference' });
      return;
    }

    // Find the Payment via its reference (set by us). The chargeId from
    // Bictorys may not be set yet if the network call to register it after
    // creation got interrupted — fall back to paymentReference.
    const payment = await prisma.payment.findUnique({
      where: { paymentReference: data.paymentReference },
      include: { subscription: true },
    });
    if (!payment) {
      logger.warn(`[bictorys-webhook] no payment for reference ${data.paymentReference}`);
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

    if (event === 'charge.successful') {
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
            bictorysChargeId: data.chargeId,
            paymentMethod: data.paymentMethod ?? null,
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
        `[bictorys-webhook] paid: org=${sub.organizationId} sub=${sub.id} amount=${payment.amount} ${payment.currency}`
      );

      res.status(200).json({ received: true });
      return;
    }

    if (event === 'charge.failed') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          webhookReceivedAt: new Date(),
          bictorysChargeId: data.chargeId,
          failureReason: data.failureReason ?? 'unknown',
        },
      });
      // Subscription stays PENDING_PAYMENT — the user can retry by going
      // through checkout again (which generates a fresh paymentReference).
      logger.info(
        `[bictorys-webhook] failed: payment=${payment.id} reason=${data.failureReason ?? 'n/a'}`
      );
      res.status(200).json({ received: true });
      return;
    }

    if (event === 'charge.pending') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { webhookReceivedAt: new Date(), bictorysChargeId: data.chargeId },
      });
      res.status(200).json({ received: true });
      return;
    }

    // Unknown event — log and ack so Bictorys doesn't retry.
    logger.warn(`[bictorys-webhook] unknown event: ${event}`);
    res.status(200).json({ received: true, note: 'unknown event' });
  } catch (err) {
    next(err);
  }
};
