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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) throw new NotFoundError('Utilisateur introuvable.');

    const paymentReference = newPaymentReference();

    // We create the Organization, OrganizationMember (admin), Subscription,
    // and Payment in a single transaction — if Bictorys later fails we don't
    // leave half-created rows behind. The Org sits in DRAFT until the webhook
    // arrives.
    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: teamName.trim(),
          slug: slugifyOrgName(teamName),
          createdById: userId,
          status: 'DRAFT',
          members: {
            create: {
              userId,
              role: 'ADMIN',
              status: 'ACTIVE',
            },
          },
        },
      });

      const subscription = await tx.subscription.create({
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

    // Now hit Bictorys. If this throws we leave the DRAFT rows behind — a
    // janitor cron (TODO) will clean DRAFT orgs > 24h old. We don't roll
    // back because the user might retry with the same payment reference.
    try {
      const charge = await bictorysService.createCharge({
        amount,
        currency: currency as Currency,
        paymentReference,
        successRedirectUrl: `${config.frontendUrl}/checkout/return?ref=${paymentReference}`,
        errorRedirectUrl: `${config.frontendUrl}/checkout/return?ref=${paymentReference}&error=1`,
        customer: {
          name: user.name,
          email: user.email,
        },
      });

      await prisma.payment.update({
        where: { id: created.payment.id },
        data: { bictorysChargeId: charge.chargeId },
      });

      ApiResponse.created(res, {
        organizationId: created.org.id,
        paymentReference,
        checkoutUrl: charge.checkoutUrl,
      });
    } catch (chargeErr) {
      logger.error(`[checkout] Bictorys error: ${(chargeErr as Error).message}`);
      // Mark the Payment row failed so the user can retry with a new ref
      // without leaving stale PENDING rows.
      await prisma.payment.update({
        where: { id: created.payment.id },
        data: { status: 'FAILED', failureReason: (chargeErr as Error).message },
      });
      throw new BadRequestError(
        "Le paiement n'a pas pu être initié. Réessayez dans un instant."
      );
    }
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

    ApiResponse.success(res, {
      paymentStatus: payment.status,
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
