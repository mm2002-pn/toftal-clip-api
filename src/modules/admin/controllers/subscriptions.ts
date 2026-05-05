/**
 * Admin views for Subscription rows.
 *
 * Read-mostly: the list endpoint feeds an admin dashboard so we can spot
 * stuck PENDING_PAYMENT, expiring trials, and PAST_DUE renewals at a
 * glance. The cancel action is the one mutation — useful for support
 * cases where a customer email asks "please cancel my plan" before the
 * self-serve cancel UI lands.
 *
 * Listing supports basic filters and offset pagination (admin volumes
 * stay small at launch — cursor pagination would be premature here;
 * revisit when subscription_count > a few thousand).
 *
 * Pricing/MRR: we report the per-plan price in the org's currency for
 * each row. Aggregate "MRR" calculations are deliberately out of scope
 * — that lives in the Metrics page once we expose it.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';
import { logger } from '../../../utils/logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/v1/admin/subscriptions?status=&planSlug=&search=&limit=&offset=
 *
 * Returns a list of subscriptions enriched with the data the admin
 * actually needs: org name + status, plan slug + name, member/project
 * counts, payment summary (count + last payment status). Sorted by
 * `updatedAt DESC` so the most recently mutated rows surface first.
 */
export const listAdminSubscriptions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const status = (req.query.status as string | undefined)?.toUpperCase();
    const planSlug = (req.query.planSlug as string | undefined)?.toLowerCase();
    const search = (req.query.search as string | undefined)?.trim() || '';
    const limit = Math.min(MAX_LIMIT, Number(req.query.limit) || DEFAULT_LIMIT);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: any = {};
    if (status) where.status = status;
    if (planSlug) where.plan = { slug: planSlug };
    if (search) {
      where.organization = {
        name: { contains: search, mode: 'insensitive' },
      };
    }

    const [total, subs] = await prisma.$transaction([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          plan: { select: { id: true, slug: true, name: true, prices: true, isCustom: true } },
          organization: {
            select: {
              id: true,
              name: true,
              status: true,
              _count: { select: { members: { where: { status: 'ACTIVE' } } } },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              amount: true,
              currency: true,
              processedAt: true,
              createdAt: true,
              paymentMethod: true,
            },
          },
          _count: { select: { payments: true } },
        },
      }),
    ]);

    // Lightweight project count via a single grouped query — N+1 would be
    // wasteful for an admin list view.
    const orgIds = subs.map((s) => s.organizationId);
    const projectCounts = orgIds.length
      ? await prisma.project.groupBy({
          by: ['organizationId'],
          where: { organizationId: { in: orgIds }, deletedAt: null },
          _count: { _all: true },
        })
      : [];
    const projectCountByOrg = new Map(
      projectCounts.map((p) => [p.organizationId, p._count._all])
    );

    const items = subs.map((s) => ({
      id: s.id,
      status: s.status,
      billingCycle: s.billingCycle,
      currency: s.currency,
      trialEndsAt: s.trialEndsAt,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      nextBillingAt: s.nextBillingAt,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      cancelledAt: s.cancelledAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      plan: s.plan,
      organization: {
        id: s.organization.id,
        name: s.organization.name,
        status: s.organization.status,
        memberCount: s.organization._count.members,
        projectCount: projectCountByOrg.get(s.organization.id) ?? 0,
      },
      paymentCount: s._count.payments,
      lastPayment: s.payments[0] ?? null,
    }));

    ApiResponse.success(res, { items, total, limit, offset });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/admin/subscriptions/:id/cancel
 * Body: { immediate?: boolean }
 *
 * - `immediate: false` (default): the sub keeps running until
 *   `currentPeriodEnd`, then auto-cancels (no renewal). This matches the
 *   self-serve UX every SaaS user expects ("you can use it until …").
 * - `immediate: true`: hard-cancel — flip subscription to CANCELLED and
 *   org to SUSPENDED right away. Used for refunds / fraud / chargebacks.
 *
 * Either way, audit-logged so support can prove what changed and when.
 */
export const cancelAdminSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { immediate } = req.body as { immediate?: boolean };

    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!sub) {
      ApiResponse.notFound(res, 'Subscription introuvable');
      return;
    }
    if (sub.status === 'CANCELLED') {
      ApiResponse.badRequest(res, 'Subscription déjà annulée');
      return;
    }

    const now = new Date();
    if (immediate) {
      await prisma.$transaction([
        prisma.subscription.update({
          where: { id },
          data: { status: 'CANCELLED', cancelledAt: now, cancelAtPeriodEnd: false },
        }),
        prisma.organization.update({
          where: { id: sub.organizationId },
          data: { status: 'SUSPENDED' },
        }),
      ]);
    } else {
      await prisma.subscription.update({
        where: { id },
        data: { cancelAtPeriodEnd: true, cancelledAt: now },
      });
    }

    auditLogFromRequest(req, 'SUBSCRIPTION_CANCEL', {
      targetType: 'subscription' as any,
      targetId: id,
      metadata: {
        organizationId: sub.organizationId,
        organizationName: sub.organization.name,
        immediate: !!immediate,
        previousStatus: sub.status,
      },
    });

    logger.info(
      `[admin] cancelled sub=${id} org=${sub.organizationId} immediate=${!!immediate}`
    );

    const updated = await prisma.subscription.findUnique({ where: { id } });
    ApiResponse.success(res, updated, 'Abonnement annulé');
  } catch (err) {
    next(err);
  }
};
