/**
 * Subscriptions module — covers the paywall lifecycle for Team workspaces.
 *
 * Endpoints exposed (see ../routes/index.ts for the wiring):
 *   GET  /plans                          public list of active plans
 *   POST /subscriptions/checkout         start a paid org (auth)
 *   GET  /subscriptions/checkout/:ref/status   poll after returning from Bictorys
 *   GET  /subscriptions/me/:orgId        the org's current sub
 *
 * The webhook handler lives in webhook.ts because it must NOT be behind the
 * `authenticate` middleware — Bictorys signs requests, we verify the HMAC.
 *
 * Pricing authority: every read of `amount` for a charge comes from the
 * SubscriptionPlan row in the DB, never from the request body. The frontend
 * only sends `planSlug` + `billingCycle` + `currency`; we look up the price
 * server-side. Without this rule, a tampered request could pay 1 XOF for an
 * Agency plan.
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../../../config/database';
import { config } from '../../../config';
import { ApiResponse } from '../../../utils/apiResponse';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '../../../utils/errors';
import { bictorysService } from '../../../services/bictorysService';
import { logger } from '../../../utils/logger';
import {
  finalizePaymentSucceeded,
  finalizePaymentFailed,
} from '../services/finalizePayment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES = ['XOF'] as const;
type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Look up the per-cycle price for a plan + currency. The plan stores prices
 * as `{ "XOF": { "monthly": N, "yearly": N }, ... }` so we can add EUR / XAF
 * later without a schema change.
 */
function priceFromPlan(
  plan: { prices: any; isCustom: boolean; slug: string },
  cycle: 'MONTHLY' | 'YEARLY',
  currency: Currency
): number {
  if (plan.isCustom) {
    throw new BadRequestError(
      `Le plan ${plan.slug} est sur devis — contactez l'équipe commerciale.`
    );
  }
  const pricesByCurrency = plan.prices as Record<string, Record<string, number>>;
  const bucket = pricesByCurrency?.[currency];
  if (!bucket) {
    throw new BadRequestError(`Devise ${currency} non supportée pour ce plan.`);
  }
  const key = cycle === 'MONTHLY' ? 'monthly' : 'yearly';
  const amount = bucket[key];
  if (typeof amount !== 'number' || amount <= 0) {
    throw new BadRequestError(`Tarif ${cycle} indisponible pour ce plan.`);
  }
  return amount;
}

/**
 * Generate a payment reference we keep in our DB and pass to Bictorys. The
 * reference is what the frontend uses to poll status after the redirect, so
 * it must be unguessable AND unique. 24 random bytes hex = 48 chars.
 */
function newPaymentReference(): string {
  return `tc_${randomBytes(24).toString('hex')}`;
}

/** Slugify a team name into an organization slug. Same logic the org module
 *  uses when creating one, kept inline so this module stays self-contained. */
function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Suffix with a 4-byte random tail so two teams with the same display
  // name don't collide on the unique slug.
  return `${base || 'team'}-${randomBytes(2).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// GET /api/v1/plans  (public)
// ---------------------------------------------------------------------------

export const listPlans = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    ApiResponse.success(res, plans);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/v1/subscriptions/checkout  (auth)
// ---------------------------------------------------------------------------
//
// Body: { teamName, planSlug, billingCycle: "MONTHLY" | "YEARLY", currency? }
// Effect:
//   - Creates Organization (status=DRAFT)
//   - Creates OrganizationMember(role=ADMIN) for the caller
//   - Creates Subscription (status=PENDING_PAYMENT)
//   - Creates Payment (status=PENDING)
//   - Calls Bictorys to open a charge
//   - Returns { checkoutUrl, paymentReference } for redirect
// On webhook receipt → Org→ACTIVE, Subscription→ACTIVE, Payment→SUCCEEDED.
//
// CSRF posture: this endpoint authenticates via the JWT in the
// `Authorization: Bearer ...` header (not the refresh-token cookie). A
// cross-site form-POST can't read the JWT from the victim's localStorage
// nor add a custom Authorization header (CORS preflight would block
// it), so the classic CSRF vector doesn't apply here. The cookie is
// only consulted by /auth/refresh, which is a no-op on its own — an
// attacker rotating a token still can't use it without exfiltrating it.

export const createCheckoutSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { teamName, planSlug, billingCycle } = req.body as {
      teamName?: string;
      planSlug?: string;
      billingCycle?: 'MONTHLY' | 'YEARLY';
    };
    const currency = ((req.body?.currency as string) || 'XOF').toUpperCase();

    if (!teamName || typeof teamName !== 'string' || teamName.trim().length < 2) {
      throw new BadRequestError("Nom d'équipe requis (au moins 2 caractères).");
    }
    if (!planSlug || typeof planSlug !== 'string') {
      throw new BadRequestError('planSlug requis.');
    }
    if (billingCycle !== 'MONTHLY' && billingCycle !== 'YEARLY') {
      throw new BadRequestError('billingCycle doit être MONTHLY ou YEARLY.');
    }
    if (!SUPPORTED_CURRENCIES.includes(currency as Currency)) {
      throw new BadRequestError(`Devise non supportée: ${currency}.`);
    }

    const plan = await prisma.subscriptionPlan.findUnique({ where: { slug: planSlug } });
    if (!plan || !plan.isActive) {
      throw new NotFoundError('Plan introuvable ou désactivé.');
    }

    // Server-authoritative price — the frontend never tells us the amount.
    const amount = priceFromPlan(plan, billingCycle, currency as Currency);

    // Optional reuse of an existing org — used by the SUSPENDED banner's
    // "Pay for this team" CTA. When set, we skip the org+member creation
    // and only attach a new Subscription/Payment to the existing row.
    // Caller must be an ACTIVE admin of that org. Refuses if the org
    // already has an active subscription (don't double-bill).
    const reuseOrgIdRaw = req.body?.organizationId;
    const reuseOrgId =
      typeof reuseOrgIdRaw === 'string' && reuseOrgIdRaw.length > 0 ? reuseOrgIdRaw : null;
    let existingOrg:
      | { id: string; status: string; subscription: { id: string; status: string } | null }
      | null = null;
    if (reuseOrgId) {
      const adminMembership = await prisma.organizationMember.findFirst({
        where: { organizationId: reuseOrgId, userId, role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!adminMembership) {
        throw new BadRequestError("Vous n'êtes pas administrateur de cette équipe.");
      }
      existingOrg = await prisma.organization.findUnique({
        where: { id: reuseOrgId },
        select: { id: true, status: true, subscription: { select: { id: true, status: true } } },
      });
      if (!existingOrg) throw new NotFoundError('Équipe introuvable.');
      if (existingOrg.subscription && ['ACTIVE', 'TRIALING'].includes(existingOrg.subscription.status)) {
        throw new BadRequestError("Cette équipe a déjà un abonnement actif.");
      }
    }

    // Anti-flood guard — skip when reusing an existing org (the user
    // didn't trigger a new DRAFT, so the count is irrelevant). A
    // logged-in attacker could spam the create-team path to flood the
    // DB with DRAFT orgs and open dozens of Bictorys charges; refuse if
    // they already have 3+ DRAFTs awaiting payment.
    if (!reuseOrgId) {
      const pendingDrafts = await prisma.organization.count({
        where: { createdById: userId, status: 'DRAFT' },
      });
      if (pendingDrafts >= 3) {
        throw new BadRequestError(
          'Trop de paiements en cours. Finalisez ou attendez avant de créer une nouvelle équipe.'
        );
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) throw new NotFoundError('Utilisateur introuvable.');

    // Bictorys requires a phone for mobile-money. We don't store one on User
    // today, so we accept it from the body — the frontend prompts for it on
    // the checkout page. Fall back to a placeholder (+221700000000) so the
    // request shape stays valid; Bictorys will overwrite it on their hosted
    // page when the customer actually picks an operator + number.
    const phone =
      typeof req.body?.phone === 'string' && req.body.phone.trim()
        ? req.body.phone.trim()
        : '+221700000000';
    const country = typeof req.body?.country === 'string' ? req.body.country : 'SN';

    // Free-trial branch — checked BEFORE we create any Payment row so
    // we don't pollute the payments table with sentinel SUCCEEDED rows
    // that have amount=0 (which would skew "total revenue" analytics).
    // Trial responses skip the polling page entirely: the frontend gets
    // `redirectUrl` and navigates directly.
    const {
      isFreeTrialEnabled,
      startTrialForOrg,
    } = await import('../../../services/subscriptionLimitsService');
    const trialOn = await isFreeTrialEnabled();

    if (trialOn) {
      // Reuse-or-create the org, then promote to TRIALING. No Payment.
      const trialOrg = existingOrg
        ? { id: existingOrg.id }
        : await prisma.organization.create({
            data: {
              name: teamName.trim(),
              slug: slugifyOrgName(teamName),
              createdById: userId,
              status: 'DRAFT',
              members: { create: { userId, role: 'ADMIN', status: 'ACTIVE' } },
            },
            select: { id: true },
          });

      // If we're reusing an existing org's subscription, update it; else
      // create a fresh one. The plan + billing cycle the caller picked
      // determines the trial period boundaries.
      const trialSub = existingOrg?.subscription
        ? await prisma.subscription.update({
            where: { id: existingOrg.subscription.id },
            data: { planId: plan.id, billingCycle, currency, status: 'PENDING_PAYMENT' },
            select: { id: true },
          })
        : await prisma.subscription.create({
            data: {
              organizationId: trialOrg.id,
              planId: plan.id,
              billingCycle,
              currency,
              status: 'PENDING_PAYMENT',
            },
            select: { id: true },
          });

      await startTrialForOrg(trialOrg.id, trialSub.id);
      ApiResponse.created(res, {
        organizationId: trialOrg.id,
        trial: true,
        // Frontend wizard navigates here directly when `redirectUrl` is
        // present in the response — bypasses the checkout-processing
        // poll loop entirely.
        redirectUrl: `${config.frontendUrl}/#/projects?trial=started`,
      });
      return;
    }

    const paymentReference = newPaymentReference();

    // Paid path — creates org (or reuses), subscription, and Payment in
    // a single transaction so we don't leave partial rows on failure.
    // Org sits in DRAFT (or stays SUSPENDED for reuse) until the
    // Bictorys webhook flips it ACTIVE. The Bictorys call is fired
    // AFTER the response is sent (see WAF timing note below).
    const created = await prisma.$transaction(async (tx) => {
      const org = existingOrg
        ? // Reuse path — keep status as-is (likely SUSPENDED).
          { id: existingOrg.id }
        : await tx.organization.create({
            data: {
              name: teamName.trim(),
              slug: slugifyOrgName(teamName),
              createdById: userId,
              status: 'DRAFT',
              members: { create: { userId, role: 'ADMIN', status: 'ACTIVE' } },
            },
            select: { id: true },
          });

      // Reuse: the org has a (likely PAST_DUE / CANCELLED) sub already —
      // update it. Else create a fresh one.
      const subscription = existingOrg?.subscription
        ? await tx.subscription.update({
            where: { id: existingOrg.subscription.id },
            data: { planId: plan.id, billingCycle, currency, status: 'PENDING_PAYMENT' },
          })
        : await tx.subscription.create({
            data: {
              organizationId: org.id,
              planId: plan.id,
              billingCycle,
              currency,
              status: 'PENDING_PAYMENT',
            },
          });

      const payment = await tx.payment.create({
        data: {
          subscriptionId: subscription.id,
          paymentReference,
          amount,
          currency,
          status: 'PENDING',
        },
      });

      return { org, subscription, payment };
    });

    // Bictorys' WAF rejects bodies containing http://localhost redirect
    // URLs (their "payment redirect must be public HTTPS" rule). In dev
    // we substitute the staging frontend as a Bictorys-acceptable
    // placeholder; the actual redirect doesn't matter since dev tests
    // poll the status endpoint instead. In prod, frontendUrl is HTTPS
    // and gets used verbatim.
    const redirectBase = config.frontendUrl.startsWith('http://')
      ? 'https://staging.toftalclip.io'
      : config.frontendUrl;
    // SPA uses HashRouter, so the path must be hash-prefixed or
    // /checkout/return won't match (Netlify SPA fallback serves
    // index.html, but HashRouter ignores the URL pathname — only the
    // fragment after `#` is routed).
    const successRedirectUrl = `${redirectBase}/#/checkout/return?ref=${paymentReference}`;
    const errorRedirectUrl = `${redirectBase}/#/checkout/return?ref=${paymentReference}&error=1`;

    // Force `Connection: close` so the client doesn't keep-alive the
    // inbound socket — that would defeat the WAF workaround below
    // (their AWS ELB blocks outbound requests fired while an inbound
    // is still open from the same process).
    res.set('Connection', 'close');

    // Listener attached BEFORE the response is sent so we don't race
    // with the 'close' event firing synchronously on small payloads.
    // 500ms safety margin on top of the close-detection — empirically
    // 2s of pure setTimeout works but is fragile under load (cold
    // starts can drift); waiting for actual socket close + a small
    // buffer is far more robust.
    const fireBictorysCharge = () => {
      void (async () => {
        try {
          const charge = await bictorysService.createCharge({
            amount,
            currency: currency as Currency,
            paymentReference,
            successRedirectUrl,
            errorRedirectUrl,
          });
          await prisma.payment.update({
            where: { id: created.payment.id },
            data: {
              bictorysChargeId: charge.chargeId,
              checkoutUrl: charge.checkoutUrl,
            },
          });
          logger.info(
            `[checkout] charge ready ref=${paymentReference} url=${charge.checkoutUrl.slice(0, 60)}...`
          );
        } catch (chargeErr) {
          logger.error(
            `[checkout] async charge failed ref=${paymentReference}: ${(chargeErr as Error).message}`
          );
          await prisma.payment.update({
            where: { id: created.payment.id },
            data: {
              status: 'FAILED',
              failureReason: (chargeErr as Error).message.slice(0, 500),
            },
          });
        }
      })();
    };
    res.once('close', () => setTimeout(fireBictorysCharge, 500));

    // Respond NOW with the paymentReference so the inbound TCP socket
    // closes — see WAF note above. The frontend polls
    // /subscriptions/checkout/:reference/status until checkoutUrl is
    // populated, then redirects.
    ApiResponse.created(res, {
      organizationId: created.org.id,
      paymentReference,
    });

    void user;
    void phone;
    void country;
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/subscriptions/checkout/:reference/status  (auth)
// ---------------------------------------------------------------------------
//
// The frontend polls this after the redirect from Bictorys. We don't trust
// the URL params — we look up the Payment, and only return the org info
// when the row is owned by the caller.
//
// **Active fallback for an unreliable webhook**: Bictorys' sandbox often
// doesn't deliver webhooks at all, and even in prod they sometimes lag /
// retry. Rather than blocking the user on `PENDING` until the webhook
// lands, this endpoint ALSO asks Bictorys directly for the charge state
// when our DB row is still PENDING. If Bictorys says "succeeded" we run
// the same finalisation transaction the webhook would have run.
//
// **WAF gotcha — fire-and-forget pattern**: Bictorys' WAF rejects any
// outbound call made while an inbound HTTP socket is still open from the
// same process (see bictorysService.ts header). So we DON'T block the
// poll on `verifyChargeStatus` — we send the response with the current
// DB state immediately, then run the verify after the inbound socket
// has closed (`res.once('close')` + 500ms safety margin). The result of
// the verify lands in the DB and is read by the *next* poll, ~1.5s later.
//
// To avoid spamming Bictorys' API: per-payment throttle (1 verify call
// per ~1.5s — same cadence as the frontend polling). Once we transition
// out of PENDING, we never call Bictorys again for that ref. This caps
// a single checkout at ~20 Bictorys verify calls (30s polling window)
// and at zero once the state is terminal.
//
// The webhook stays the fast path: when Bictorys does deliver, it flips
// the row in <1s and subsequent polls just read the DB.

// In-memory throttle for Bictorys verify calls. Keyed by paymentReference,
// value = last call timestamp (ms). Survives the lifetime of the Cloud Run
// instance — multi-instance fleets multiply this by the instance count
// in the worst case, which is still negligible vs. the webhook path.
const lastBictorysVerifyAt = new Map<string, number>();
const BICTORYS_VERIFY_THROTTLE_MS = 1500;

/**
 * Garbage-collect entries older than 10 min so the Map can't grow without
 * bound under sustained traffic. Cheap because we only care about active
 * checkouts (most resolve in <30s).
 */
function pruneVerifyCache() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, ts] of lastBictorysVerifyAt) {
    if (ts < cutoff) lastBictorysVerifyAt.delete(k);
  }
}

export const getCheckoutStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const reference = String(req.params.reference || '');

    const payment = await prisma.payment.findUnique({
      where: { paymentReference: reference },
      include: {
        subscription: {
          include: {
            organization: { include: { members: { where: { userId } } } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundError('Référence de paiement introuvable.');

    // Only the org admin who initiated the checkout can poll. We check via
    // an OrganizationMember row (the createdById is also the org admin, so
    // this is equivalent — but we go through membership for symmetry with
    // the rest of the codebase).
    if (payment.subscription.organization.members.length === 0) {
      throw new ForbiddenError("Vous n'avez pas accès à ce paiement.");
    }

    // ACTIVE FALLBACK — only schedule a verify when:
    //   - the payment is still pending (terminal states need no probing)
    //   - Bictorys has assigned a chargeId (set by the async charge call;
    //     null in the very first ~2s after checkout creation)
    //   - we haven't probed in the last 1.5s for this ref (throttle)
    const now = Date.now();
    const last = lastBictorysVerifyAt.get(reference) ?? 0;
    const shouldProbe =
      payment.status === 'PENDING' &&
      !!payment.bictorysChargeId &&
      now - last >= BICTORYS_VERIFY_THROTTLE_MS;

    if (shouldProbe) {
      // Reserve the throttle slot BEFORE scheduling so concurrent polls
      // see the bump and skip. The actual call fires only after the
      // inbound socket closes (WAF requirement).
      lastBictorysVerifyAt.set(reference, now);
      pruneVerifyCache();

      // Snapshot what the async closure needs — `payment` is local but the
      // closure runs after the handler returns, so capture the IDs.
      const snapshot = {
        paymentId: payment.id,
        subscriptionId: payment.subscription.id,
        organizationId: payment.subscription.organizationId,
        billingCycle: payment.subscription.billingCycle,
        bictorysChargeId: payment.bictorysChargeId!,
      };

      const fireVerify = () => {
        void (async () => {
          try {
            const remote = await bictorysService.verifyChargeStatus(
              snapshot.bictorysChargeId
            );
            if (remote.status === 'succeeded') {
              const activated = await finalizePaymentSucceeded({
                ...snapshot,
                paymentMethod: remote.paymentMethod ?? null,
                observedAt: new Date(),
              });
              if (activated) {
                logger.info(
                  `[checkout-status] activated via polling: ref=${reference} org=${snapshot.organizationId}`
                );
              }
            } else if (remote.status === 'failed') {
              const marked = await finalizePaymentFailed({
                paymentId: snapshot.paymentId,
                bictorysChargeId: snapshot.bictorysChargeId,
                failureReason: remote.failureReason ?? 'failed',
                observedAt: new Date(),
              });
              if (marked) {
                logger.info(
                  `[checkout-status] marked failed via polling: ref=${reference}`
                );
              }
            }
            // 'pending' → leave as-is, the next poll will retry the verify
          } catch (err) {
            // Bictorys API hiccup — log and exit. The throttle resets on
            // the next poll (1.5s later) and the verify will retry. We
            // keep the slot reserved here so a 1-off failure doesn't open
            // an immediate retry storm.
            logger.warn(
              `[checkout-status] verifyChargeStatus failed ref=${reference}: ${(err as Error).message}`
            );
          }
        })();
      };

      // Force `Connection: close` and wait for the actual TCP close before
      // firing — same WAF workaround as createCharge. The 500ms margin on
      // top of the close event compensates for cold-start drift in Cloud
      // Run; pure setTimeout fires too early under load.
      res.set('Connection', 'close');
      res.once('close', () => setTimeout(fireVerify, 500));
    }

    // Frontend uses these fields:
    //   - checkoutUrl: when populated → redirect there
    //   - paymentStatus: 'PENDING' (still waiting for Bictorys) | 'SUCCEEDED' (paid) | 'FAILED' (retry)
    //   - subscriptionStatus / organizationStatus: post-payment success state
    //
    // We respond with whatever's currently in the DB. If the verify above
    // was scheduled, its result will land before the next poll (~1.5s),
    // so the user sees activation on the following tick at the latest.
    ApiResponse.success(res, {
      paymentStatus: payment.status,
      checkoutUrl: payment.checkoutUrl,
      subscriptionStatus: payment.subscription.status,
      organizationId: payment.subscription.organizationId,
      organizationStatus: payment.subscription.organization.status,
      paymentMethod: payment.paymentMethod,
      failureReason: payment.failureReason,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/subscriptions/me/:orgId  (auth)
// ---------------------------------------------------------------------------

export const getMySubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId);

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenError('Non membre de cette équipe.');

    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });

    if (!subscription) {
      ApiResponse.success(res, null, 'Aucun abonnement actif');
      return;
    }
    ApiResponse.success(res, subscription);
  } catch (err) {
    next(err);
  }
};
