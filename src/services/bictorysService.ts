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
  /** Where Bictorys redirects after the user completes / fails / cancels. */
  successRedirectUrl: string;
  errorRedirectUrl: string;
  /** Customer info — Bictorys requires phone for mobile-money. Empty
   *  values are fine, the hosted page lets the user fill them in. */
  customer: {
    name: string;
    email: string;
    phone: string;
    city?: string;
    country?: string;
    locale?: string;
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
    // The hosted-checkout flow uses the PUBLIC key (per Bictorys' direct-api
    // docs example). The secret key is for server-only operations like
    // refunds — we don't expose it on this path.
    return !!config.bictorys.publicKey && !!config.bictorys.apiUrl;
  }

  /**
   * Open a charge on Bictorys' side. Returns the URL to redirect the user to.
   * Throws on any non-2xx — callers turn this into a user-facing error.
   *
   * Wire format follows their direct-api doc verbatim. `merchantReference`
   * and `paymentReference` are both ours: Bictorys treats merchantReference
   * as the cross-system idempotency key and paymentReference as the
   * customer-visible label on receipts; we use the same value for both.
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (!this.isConfigured()) {
      throw new Error('Bictorys is not configured (missing BICTORYS_PUBLIC_KEY)');
    }

    // No `payment_type` query param → Bictorys returns a CheckoutLinkObject
    // pointing to their hosted checkout page where the user picks the
    // operator (Orange Money / Wave / Free / cards). Specifying payment_type
    // bypasses the picker and returns a single-operator MobilePaymentObject,
    // which we'd need to render ourselves — not what we want here.
    const url = `${config.bictorys.apiUrl}/pay/v1/charges`;

    // Checkout integration payload — per Bictorys' Checkout doc:
    //   amount + currency are mandatory; everything else helps the receipt
    //   and the hosted-page UX. Fields named `customerObject` and the dual
    //   success/error redirect URLs are specific to Checkout (the Direct API
    //   uses `customer` and a single `redirectUrl` instead).
    const body = {
      amount: input.amount,
      currency: input.currency,
      paymentReference: input.paymentReference,
      merchantReference: input.paymentReference,
      successRedirectUrl: input.successRedirectUrl,
      errorRedirectUrl: input.errorRedirectUrl,
      customerObject: {
        name: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone,
        city: input.customer.city ?? 'Dakar',
        country: input.customer.country ?? 'SN',
        locale: input.customer.locale ?? 'fr-FR',
      },
      allowUpdateCustomer: true,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Bictorys is fronted by an AWS ELB whose WAF rejects requests
        // identifying as a generic API client (e.g. "toftal-clip-api" gets
        // a 403 even with a valid key + payload). Plain "Mozilla/5.0" goes
        // through consistently — confirmed against api.test.bictorys.com
        // 2026-05-04. Will revisit if Bictorys whitelists a service UA.
        'User-Agent': 'Mozilla/5.0',
        'X-Api-Key': config.bictorys.publicKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error(`[Bictorys] createCharge failed ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Bictorys charge creation failed (${res.status})`);
    }

    // Hosted checkout response shape (CheckoutLinkObject):
    //   { type, link, chargeId, opToken }
    // `link` is what we redirect the user to. `chargeId` is what we save for
    // idempotence on the webhook.
    const json = (await res.json()) as {
      type?: string;
      link?: string;
      chargeId?: string;
    };
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
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Api-Key': config.bictorys.publicKey,
      },
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
