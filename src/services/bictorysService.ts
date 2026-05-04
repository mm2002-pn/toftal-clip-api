/**
 * Bictorys integration — thin wrapper around their HTTP API.
 *
 * Why a service: every controller that touches a charge (initial checkout,
 * renewal cron, retry) goes through the same auth / error handling path.
 * Keeping the wire format here also means swapping providers later (e.g.
 * PayDunya as a fallback) only changes one file.
 *
 * Auth: Bictorys uses an `X-Api-Key` header with the secret key. We only
 * use the secret-key endpoint for charges (creating + verifying). The public
 * key would be for client-side widgets, which we don't use — we rely on
 * their hosted checkout page for PCI compliance, no card data ever hits
 * our backend.
 *
 * Webhook: every state transition Bictorys notifies us about is signed.
 * `verifyWebhookSignature` is the authentication for that route — without
 * it any attacker could POST a fake `charge.successful` and unlock orgs.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreateChargeInput {
  /** Amount in the currency's smallest unit (XOF has none → 19900 = 19 900 F). */
  amount: number;
  currency: 'XOF' | 'XAF' | 'NGN' | 'GNF';
  /** Our own opaque ref. Saved in `payments.payment_reference`; used to look up
   *  the Payment when the user comes back from the hosted checkout. */
  paymentReference: string;
  /** Where Bictorys redirects after the user completes (or fails) checkout. */
  successRedirectUrl: string;
  errorRedirectUrl: string;
  /** Customer info — Bictorys uses this for receipts + risk. */
  customer: {
    name: string;
    email: string;
    phone?: string;
  };
}

export interface CreateChargeResult {
  /** Bictorys-assigned id; we save it in `payments.bictorys_charge_id` for idempotence. */
  chargeId: string;
  /** URL to redirect the user to (hosted checkout). */
  checkoutUrl: string;
}

export type BictorysWebhookEvent =
  | 'charge.successful'
  | 'charge.failed'
  | 'charge.pending';

export interface BictorysWebhookPayload {
  event: BictorysWebhookEvent;
  data: {
    chargeId: string;
    paymentReference: string;
    amount: number;
    currency: string;
    status: string;
    paymentMethod?: string;
    failureReason?: string;
    customer?: { email?: string; phone?: string; name?: string };
  };
}

class BictorysService {
  private isConfigured(): boolean {
    return !!config.bictorys.secretKey && !!config.bictorys.apiUrl;
  }

  /**
   * Open a charge on Bictorys' side. Returns the URL to redirect the user to.
   * Throws on any non-2xx — callers turn this into a user-facing error.
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured (missing BICTORYS_SECRET_KEY)');
    }

    // Default payment_type to mobile_money — the hosted checkout shows the full
    // operator picker (Orange / Wave / Free / cards) regardless, so this is
    // mostly a hint for analytics on Bictorys' side.
    const url = `${config.bictorys.apiUrl}/pay/v1/charges?payment_type=mobile_money`;

    const body = {
      amount: input.amount,
      currency: input.currency,
      paymentReference: input.paymentReference,
      successRedirectUrl: input.successRedirectUrl,
      errorRedirectUrl: input.errorRedirectUrl,
      customer: input.customer,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.bictorys.secretKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error(`[Bictorys] createCharge failed ${res.status}: ${text}`);
      throw new Error(`Bictorys charge creation failed (${res.status})`);
    }

    const json = (await res.json()) as { id?: string; checkoutUrl?: string };
    if (!json.id || !json.checkoutUrl) {
      logger.error(`[Bictorys] createCharge bad shape: ${JSON.stringify(json)}`);
      throw new Error('Bictorys returned an unexpected response');
    }

    return { chargeId: json.id, checkoutUrl: json.checkoutUrl };
  }

  /**
   * Read-only status check. Used by the reconciliation cron to catch payments
   * whose webhook never arrived (network blip on Bictorys' side, GCP cold
   * start that 502s the webhook, etc.).
   */
  async verifyChargeStatus(chargeId: string): Promise<{
    status: 'pending' | 'succeeded' | 'failed';
    paymentMethod?: string;
    failureReason?: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured');
    }

    const res = await fetch(`${config.bictorys.apiUrl}/pay/v1/charges/${chargeId}`, {
      headers: { 'X-Api-Key': config.bictorys.secretKey },
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error(`[Bictorys] verifyChargeStatus failed ${res.status}: ${text}`);
      throw new Error(`Bictorys charge lookup failed (${res.status})`);
    }

    const json = (await res.json()) as {
      status?: string;
      paymentMethod?: string;
      failureReason?: string;
    };

    // Map Bictorys status strings to our small enum. Anything unknown is
    // treated as pending so we don't accidentally finalise a payment we
    // don't understand.
    const raw = (json.status || '').toLowerCase();
    let status: 'pending' | 'succeeded' | 'failed' = 'pending';
    if (raw === 'succeeded' || raw === 'success' || raw === 'completed') status = 'succeeded';
    else if (raw === 'failed' || raw === 'cancelled' || raw === 'rejected') status = 'failed';

    return {
      status,
      paymentMethod: json.paymentMethod,
      failureReason: json.failureReason,
    };
  }

  /**
   * Verify the HMAC signature of a webhook delivery.
   *
   * Bictorys signs the raw request body with the webhook secret (HMAC-SHA256)
   * and sends the hex digest in `X-Bictorys-Signature`. We recompute and
   * timing-safe-compare. Without this check, anyone who guesses the route
   * URL can POST a fake `charge.successful` and unlock an org for free.
   *
   * Note: pass the *raw* request body string, not the parsed JSON, because
   * even key reordering changes the hash.
   */
  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature || !config.bictorys.webhookSecret) {
      return false;
    }

    const expected = createHmac('sha256', config.bictorys.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    // timingSafeEqual throws on length mismatch — guard first.
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;

    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

export const bictorysService = new BictorysService();
