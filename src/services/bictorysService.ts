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
 * Webhook auth (per Bictorys integration guide, March 2026):
 *   - Method 1 (preferred when present): HMAC-SHA256 of `<timestamp>.<body>`
 *     in `X-Webhook-Signature`, with `X-Webhook-Timestamp` for replay
 *     protection (5 min window).
 *   - Method 2 (fallback, what they actually send): static `X-Secret-Key`
 *     header echoing the configured webhook secret in plain text.
 * `verifyWebhook` accepts either; both use timing-safe compare. Without
 * this check, anyone hitting the public route could fake a `succeeded`
 * payload and unlock orgs for free.
 *
 * **No status-check endpoint**. Bictorys confirmed `GET /pay/v1/charges/{id}`
 * does not exist as a real API — the 500s we saw were not a sandbox quirk,
 * just an absent route. Webhook is the only source of truth for terminal
 * payment state.
 *
 * ============================================================
 * ⚠️ AWS WAF gotchas — read this before changing call sites
 * ============================================================
 *
 * Bictorys is fronted by an AWS ELB whose WAF has bitten us twice
 * during integration. (A third rule — "inbound-in-flight blocking",
 * where an outbound fired from an open Express handler returned 403 —
 * was retested in May 2026 and no longer triggers. Sync calls from
 * inside controllers are now safe.)
 *
 *   1. **Browser-like User-Agent required**. Plain identifiers like
 *      "toftal-clip-api" or empty UA → 403. `User-Agent: Mozilla/5.0`
 *      reliably goes through.
 *
 *   2. **Public HTTPS redirect URLs**. Payloads containing `http://localhost`
 *      (or any non-HTTPS / private redirect URL) get 403. The dev workaround
 *      is to substitute `https://staging.toftalclip.io` when frontendUrl is
 *      `http://localhost` — Bictorys never actually calls the redirect URL
 *      in sandbox-mobile-money payments anyway (per their docs).
 *
 * If you find yourself getting unexplained 403s, suspect these two
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
  /**
   * Bictorys country code — required by their API. Valid: `SN`, `CI`,
   * `BK` (Burkina), `ML`, `TG`, `BJ`. Defaults to `SN` since that's our
   * primary launch market.
   */
  country?: 'SN' | 'CI' | 'BK' | 'ML' | 'TG' | 'BJ';
  /** Our own opaque ref. Saved in `payments.payment_reference`; used to look up
   *  the Payment when the user comes back from the hosted checkout. */
  paymentReference: string;
  /** Where Bictorys redirects after the user completes / fails / cancels. */
  successRedirectUrl: string;
  errorRedirectUrl: string;
  /**
   * Optional customer info, recommended by Bictorys. Phone must be in
   * `+INDICATIF` + `NUMERO` format with no spaces (e.g. `+221771234567`).
   */
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
    country?: 'SN' | 'CI' | 'BK' | 'ML' | 'TG' | 'BJ';
  };
}

export interface CreateChargeResult {
  /** Bictorys-assigned id; we save it in `payments.bictorys_charge_id` for idempotence. */
  chargeId: string;
  /** URL to redirect the user to (hosted checkout). */
  checkoutUrl: string;
}

/**
 * Bictorys webhook payload — flat object, NOT enveloped in `{event, data}`.
 * The transition is conveyed by `status` ("succeeded" / "failed" / "pending"),
 * not by an event-name field. `id` is Bictorys' chargeId, `pspName` is the
 * actual rail used (card / wave_money / orange_money / …).
 *
 * Source: Bictorys integration guide (March 2026). They warn that fields
 * can be added without notice; do not strict-validate on unknown keys.
 */
export interface BictorysWebhookPayload {
  /** Bictorys-assigned transaction id. We persist it on payments.bictorys_charge_id. */
  id: string;
  /** Echo of the `paymentReference` we sent at charge creation. Our lookup key. */
  paymentReference: string;
  /** Lowercase status string — `succeeded` / `failed` / `pending` / `cancelled` / `authorized` / `reversed`. */
  status: string;
  amount?: number;
  currency?: string;
  /** PSP rail (card, wave_money, orange_money, …). */
  pspName?: string;
  paymentMeans?: string;
  merchantReference?: string;
  customerObject?: {
    name?: string;
    email?: string;
    phone?: string | number;
    country?: string;
    locale?: string;
  };
  failureReason?: string;
  timestamp?: string;
}

/** Replay-protection window for HMAC-signed webhooks (5 min). */
const HMAC_REPLAY_WINDOW_MS = 5 * 60 * 1000;

class BictorysService {
  private isConfigured(): boolean {
    return !!config.bictorys.publicKey && !!config.bictorys.apiUrl;
  }

  /**
   * Open a charge on Bictorys' side. Returns the URL to redirect the user to.
   * Throws on any non-2xx — callers turn this into a user-facing error.
   *
   * Wire format: see https://docs.bictorys.com/docs/checkout. `amount`,
   * `currency`, `country`, `paymentReference`, `successRedirectUrl` and
   * `ErrorRedirectUrl` (note the capital E — Bictorys' field name) are all
   * required. No `payment_type` query param → returns a CheckoutLinkObject
   * pointing at the hosted page where the user picks operator (Wave /
   * Orange Money / cards). Specifying payment_type bypasses the picker
   * and returns a single-operator MobilePaymentObject we'd need to render
   * ourselves — not what we want.
   *
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured (missing BICTORYS_PUBLIC_KEY)');
    }

    const apiUrl = new URL(config.bictorys.apiUrl);
    const payload: Record<string, unknown> = {
      amount: input.amount,
      currency: input.currency,
      country: input.country || 'SN',
      paymentReference: input.paymentReference,
      successRedirectUrl: input.successRedirectUrl,
      // ⚠️ Bictorys' field name uses a capital `E` ("ErrorRedirectUrl").
      // Lowercase variants are silently ignored by their API.
      ErrorRedirectUrl: input.errorRedirectUrl,
    };
    if (input.customer) {
      payload.customerObject = {
        ...(input.customer.name ? { name: input.customer.name } : {}),
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        ...(input.customer.email ? { email: input.customer.email } : {}),
        country: input.customer.country || input.country || 'SN',
      };
    }
    const bodyJson = JSON.stringify(payload);

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
   * Verify the authenticity of an incoming webhook delivery.
   *
   * Tries HMAC first (preferred — replay-protected via timestamp), falls
   * back to the static `X-Secret-Key` echo. Both compare timing-safely
   * to avoid leaking the secret through response-time differences.
   *
   * Returns true iff at least one method validates. Caller is responsible
   * for returning 401 on false.
   */
  verifyWebhook(input: {
    rawBody: string;
    headerSecret?: string;
    headerSignature?: string;
    headerTimestamp?: string;
  }): boolean {
    const expected = config.bictorys.webhookSecret;
    if (!expected) {
      // Misconfigured server — refuse all webhooks loud enough that we
      // notice in logs.
      return false;
    }

    // Method 1: HMAC-SHA256 over `<timestamp>.<rawBody>`.
    if (input.headerSignature && input.headerTimestamp) {
      const ts = parseInt(input.headerTimestamp, 10);
      if (!Number.isNaN(ts) && Math.abs(Date.now() - ts) <= HMAC_REPLAY_WINDOW_MS) {
        try {
          const computed = createHmac('sha256', expected)
            .update(`${input.headerTimestamp}.${input.rawBody}`)
            .digest('hex');
          const a = Buffer.from(input.headerSignature, 'utf8');
          const b = Buffer.from(computed, 'utf8');
          if (a.length === b.length && timingSafeEqual(a, b)) return true;
        } catch {
          // fall through to static-key check
        }
      }
      // If HMAC headers were present but invalid, do NOT auto-accept the
      // static-key fallback — we'd downgrade to a weaker auth method.
      // Reject hard.
      return false;
    }

    // Method 2: static X-Secret-Key fallback (when HMAC headers absent).
    if (input.headerSecret) {
      const a = Buffer.from(input.headerSecret, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length) return false;
      try {
        return timingSafeEqual(a, b);
      } catch {
        return false;
      }
    }

    return false;
  }
}

export const bictorysService = new BictorysService();
