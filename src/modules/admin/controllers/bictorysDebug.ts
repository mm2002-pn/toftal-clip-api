/**
 * Admin debug endpoint — tests if Bictorys' WAF still blocks outbound
 * charge calls fired from INSIDE an inbound HTTP handler.
 *
 * The original integration (early 2026) bumped into "inbound-in-flight
 * blocking": every `POST /pay/v1/charges` issued before the inbound
 * response was sent returned 403. We worked around it with the
 * `res.once('close') + setTimeout(500)` fire-and-forget pattern in
 * createCheckoutSession.
 *
 * That workaround is heavy to maintain (Connection: close header,
 * snapshot capture for the closure, async DB updates after the
 * response). If Bictorys' WAF behaviour has changed, we want to know
 * so we can drop it.
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer <admin-jwt>" \
 *     https://api.staging.toftalclip.io/api/v1/admin/debug/bictorys-test-charge
 *
 * Returns timings, the HTTP status Bictorys gave us, and whether the
 * call succeeded synchronously (i.e. WITHOUT the workaround). If WAF
 * is still blocking → status will be 403 and we keep the workaround.
 *
 * Safe to call repeatedly — never persists anything (uses a fake
 * paymentReference, no Subscription / Payment row created). Bictorys
 * will allocate a real chargeId we just ignore on their side.
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { bictorysService } from '../../../services/bictorysService';
import { ApiResponse } from '../../../utils/apiResponse';

export const debugBictorysTestCharge = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startedAt = Date.now();
  const paymentReference = `debug_${randomBytes(8).toString('hex')}_${Date.now()}`;

  try {
    // Synchronous call — NO `res.once('close')`, NO `setTimeout`, NO
    // `Connection: close`. The inbound HTTP socket is wide open while
    // we hit Bictorys. If their WAF still blocks, we'll see a 403.
    const charge = await bictorysService.createCharge({
      amount: 100, // minimum, won't go anywhere — paymentReference is throwaway
      currency: 'XOF',
      country: 'SN',
      paymentReference,
      successRedirectUrl: 'https://staging.toftalclip.io/#/debug/success',
      errorRedirectUrl: 'https://staging.toftalclip.io/#/debug/error',
    });

    ApiResponse.success(res, {
      result: 'ok',
      durationMs: Date.now() - startedAt,
      paymentReference,
      chargeId: charge.chargeId,
      checkoutUrl: charge.checkoutUrl,
      verdict: 'WAF passes through synchronous calls — workaround can be dropped.',
    });
  } catch (err) {
    const message = (err as Error).message;
    const wafBlocked = /403/.test(message) || /Forbidden/i.test(message);

    ApiResponse.success(res, {
      result: 'error',
      durationMs: Date.now() - startedAt,
      paymentReference,
      message,
      wafBlocked,
      verdict: wafBlocked
        ? 'WAF still blocks synchronous calls — keep the res.once(close) workaround.'
        : 'Different error (auth, network, validation). WAF may not be the cause.',
    });
  }
};
