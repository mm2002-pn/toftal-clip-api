/**
 * Shared finalisation logic for a Bictorys charge.
 *
 * Two call sites:
 *   1. The webhook handler (webhook.ts) — fast path. When Bictorys actually
 *      delivers the notification, we activate the org in <1s.
 *   2. The polling endpoint (controllers/index.ts:getCheckoutStatus) —
 *      fallback. The frontend polls /status while waiting for the webhook;
 *      that endpoint actively asks Bictorys for the current state, so we
 *      don't depend on their webhook delivery (which is unreliable in
 *      sandbox and sometimes in prod). When the polled status is terminal,
 *      these helpers do the same DB work the webhook would have done.
 *
 * Both helpers are idempotent — they no-op if the payment is already in a
 * terminal state. Concurrent calls from the two paths are safe; whichever
 * runs first wins, the second is a quick guarded read.
 */

import type { BillingCycle } from '@prisma/client';
import { prisma } from '../../../config/database';

/**
 * Period boundaries for a Subscription that just became active. MONTHLY
 * rolls forward 1 month; YEARLY rolls forward 1 year. Stored UTC.
 */
function computePeriod(now: Date, cycle: BillingCycle) {
  const end = new Date(now);
  if (cycle === 'MONTHLY') {
    end.setMonth(end.getMonth() + 1);
  } else {
    end.setFullYear(end.getFullYear() + 1);
  }
  return { start: now, end, nextBillingAt: end };
}

export interface FinalizeContext {
  paymentId: string;
  subscriptionId: string;
  organizationId: string;
  billingCycle: BillingCycle;
  bictorysChargeId: string;
  /** PSP rail used (card / wave_money / orange_money / …). */
  paymentMethod?: string | null;
  /** When the success was observed — webhook = `webhookReceivedAt`. */
  observedAt: Date;
}

/**
 * Mark a payment SUCCEEDED + activate the subscription and org. Wrapped
 * in a single transaction so a partial failure (e.g. org update breaks)
 * rolls back the payment update — better to be retried than leave the
 * system half-paid.
 *
 * Idempotent: short-circuits if payment is already SUCCEEDED/REFUNDED.
 * Returns true if the activation actually happened (caller can decide
 * whether to log).
 */
export async function finalizePaymentSucceeded(ctx: FinalizeContext): Promise<boolean> {
  const existing = await prisma.payment.findUnique({
    where: { id: ctx.paymentId },
    select: { status: true },
  });
  if (!existing) return false;
  if (existing.status === 'SUCCEEDED' || existing.status === 'REFUNDED') {
    return false;
  }

  const { start, end, nextBillingAt } = computePeriod(ctx.observedAt, ctx.billingCycle);

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: ctx.paymentId },
      data: {
        status: 'SUCCEEDED',
        processedAt: ctx.observedAt,
        webhookReceivedAt: ctx.observedAt,
        bictorysChargeId: ctx.bictorysChargeId,
        paymentMethod: ctx.paymentMethod ?? null,
      },
    }),
    prisma.subscription.update({
      where: { id: ctx.subscriptionId },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        nextBillingAt,
      },
    }),
    prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { status: 'ACTIVE' },
    }),
  ]);

  return true;
}

/**
 * Mark a payment FAILED. Subscription stays PENDING_PAYMENT so the user
 * can retry checkout (which mints a fresh paymentReference).
 *
 * Idempotent: no-op on payments already in a terminal state.
 */
export async function finalizePaymentFailed(input: {
  paymentId: string;
  bictorysChargeId: string;
  failureReason: string;
  observedAt: Date;
}): Promise<boolean> {
  const existing = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { status: true },
  });
  if (!existing) return false;
  if (existing.status !== 'PENDING') return false;

  await prisma.payment.update({
    where: { id: input.paymentId },
    data: {
      status: 'FAILED',
      webhookReceivedAt: input.observedAt,
      bictorysChargeId: input.bictorysChargeId,
      failureReason: input.failureReason.slice(0, 500),
    },
  });
  return true;
}
