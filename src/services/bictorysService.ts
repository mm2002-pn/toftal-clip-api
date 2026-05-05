/**
 * Bictorys integration — thin wrapper around their HTTP API.
 *
 * Why a service: every controller that touches a charge (initial checkout,
 * renewal cron, retry) goes through the same auth / error handling path.
 * Keeping the wire format here also means swapping providers later (e.g.
 * PayDunya as a fallback) only changes one file.
 *
 * Auth: Bictorys uses an `X-Api-Key` header with the PUBLIC key on the
 * hosted-checkout flow (per their docs). The secret key is for
 * server-only operations like refunds — we don't expose it on this path.
 *
 * Webhook: every state transition Bictorys notifies us about is signed.
 * `verifyWebhookSignature` is the authentication for that route — without
 * it any attacker could POST a fake `charge.successful` and unlock orgs.
 *
 * ============================================================
 * ⚠️ AWS WAF gotchas — read this before changing call sites
 * ============================================================
 *
 * Bictorys is fronted by an AWS ELB whose WAF has at least three rules
 * that bit us during integration:
 *
 *   1. **Inbound-in-flight blocking**. An outbound charge call fired from
 *      inside an Express request handler while the inbound HTTP socket is
 *      still open returns 403. The same call from `setTimeout` after the
 *      response was sent returns 202. Callers MUST `res.json(...)` first,
 *      then `setTimeout(callBictorys, 2000)` — see the subscriptions
 *      controller for the canonical pattern.
 *
 *   2. **Browser-like User-Agent required**. Plain identifiers like
 *      "toftal-clip-api" or empty UA → 403. `User-Agent: Mozilla/5.0`
 *      reliably goes through.
 *
 *   3. **Public HTTPS redirect URLs**. Payloads containing `http://localhost`
 *      (or any non-HTTPS / private redirect URL) get 403. The dev workaround
 *      is to substitute `https://staging.toftalclip.io` when frontendUrl is
 *      `http://localhost` — Bictorys never actually calls the redirect URL
 *      in sandbox-mobile-money payments anyway (per their docs).
 *
 * If you find yourself getting unexplained 403s, suspect these three
 * before debugging deeper.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import https from 'https';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreateChargeInput {
  /** Amount in the currency's smallest unit (XOF has none → 19900 = 19 900 F). */
  amount: number;
  currency: 'XOF' | 'XAF' | 'NGN' | 'GNF';
  /** Our own opaque ref. Saved in `payments.payment_reference`; used to look up
   *  the Payment when the user comes back from the hosted checkout. */
  paymentReference: string;
  /** Where Bictorys redirects after the user completes / fails / cancels. */
  successRedirectUrl: string;
  errorRedirectUrl: string;
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
    return !!config.bictorys.publicKey && !!config.bictorys.apiUrl;
  }

  /**
   * Open a charge on Bictorys' side. Returns the URL to redirect the user to.
   * Throws on any non-2xx — callers turn this into a user-facing error.
   *
   * Wire format: see https://docs.bictorys.com/docs/checkout. Only `amount`
   * and `currency` are mandatory; we include `paymentReference` (saved as
   * the customer-visible label on receipts) and the dual redirect URLs.
   * No `payment_type` query param → returns a CheckoutLinkObject pointing
   * at the hosted page where the user picks operator (Orange Money / Wave
   * / Free / cards). Specifying payment_type bypasses the picker and
   * returns a single-operator MobilePaymentObject we'd need to render
   * ourselves — not what we want.
   *
   * MUST NOT be called while an inbound HTTP request is still open — see
   * the timing note in this file's header.
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured (missing BICTORYS_PUBLIC_KEY)');
    }

    const apiUrl = new URL(config.bictorys.apiUrl);
    const bodyJson = JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      paymentReference: input.paymentReference,
      successRedirectUrl: input.successRedirectUrl,
      errorRedirectUrl: input.errorRedirectUrl,
    });

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: apiUrl.hostname,
          port: apiUrl.port || 443,
          path: '/pay/v1/charges',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyJson),
            // Browser-like UA — anything that looks like a generic API
            // client (e.g. "node-axios/x.y") gets a 403 from their WAF.
            'User-Agent': 'Mozilla/5.0',
            'X-Api-Key': config.bictorys.publicKey,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        }
      );
      req.on('error', reject);
      req.write(bodyJson);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      logger.error(
        `[Bictorys] createCharge failed ${result.status}: ${result.body.slice(0, 500)}`
      );
      throw new Error(`Bictorys charge creation failed (${result.status})`);
    }

    let json: { type?: string; link?: string; chargeId?: string };
    try {
      json = JSON.parse(result.body);
    } catch {
      logger.error(`[Bictorys] createCharge bad body: ${result.body.slice(0, 200)}`);
      throw new Error('Bictorys returned a non-JSON response');
    }
    if (!json.chargeId || !json.link) {
      logger.error(`[Bictorys] createCharge bad shape: ${JSON.stringify(json)}`);
      throw new Error('Bictorys returned an unexpected response');
    }

    return { chargeId: json.chargeId, checkoutUrl: json.link };
  }

  /**
   * Read-only status check. Used by the reconciliation cron to catch payments
   * whose webhook never arrived (network blip on Bictorys' side, GCP cold
   * start that 502s the webhook, etc.).
   *
   * Same timing constraint as createCharge — call from a non-request context.
   */
  async verifyChargeStatus(chargeId: string): Promise<{
    status: 'pending' | 'succeeded' | 'failed';
    paymentMethod?: string;
    failureReason?: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured');
    }

    const apiUrl = new URL(config.bictorys.apiUrl);
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request(
        {
          hostname: apiUrl.hostname,
          port: apiUrl.port || 443,
          path: `/pay/v1/charges/${encodeURIComponent(chargeId)}`,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'X-Api-Key': config.bictorys.publicKey,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    if (result.status < 200 || result.status >= 300) {
      logger.error(
        `[Bictorys] verifyChargeStatus failed ${result.status}: ${result.body.slice(0, 500)}`
      );
      throw new Error(`Bictorys charge lookup failed (${result.status})`);
    }

    const json = JSON.parse(result.body) as {
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
