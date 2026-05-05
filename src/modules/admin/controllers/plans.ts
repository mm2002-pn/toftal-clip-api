/**
 * Admin CRUD for SubscriptionPlan rows.
 *
 * The public `/plans` endpoint (modules/subscriptions/controllers/index.ts)
 * only returns `isActive: true` plans for the pricing page. This module
 * exposes the FULL list (incl. inactive) and write operations to the
 * admin UI. All routes are gated by `authenticate` + `authorize('ADMIN')`.
 *
 * Money is stored as the `prices` Json: `{ <ISO-currency>: { monthly, yearly } }`.
 * We accept the same shape from the form. Currency strings are uppercased
 * server-side; amounts are integers in the smallest unit (XOF has none →
 * 19900 = 19 900 F). Validation is intentionally permissive on `currency`
 * keys so we can add EUR/XAF without redeploying the validator.
 *
 * Delete behaviour: a plan with active subscriptions can't be hard-deleted
 * (FK constraint). We surface a 409 with a clear message; the admin should
 * mark `isActive: false` first to phase it out, then delete once the last
 * subscription has migrated/expired.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const SLUG_REGEX = /^[a-z0-9_-]+$/;

interface PriceMap {
  [currency: string]: { monthly: number; yearly: number };
}

/**
 * Sanity-check the `prices` Json. Throws a string we can return as a 400.
 * Loose schema by design — see header.
 */
function validatePrices(raw: unknown): PriceMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw 'prices must be an object keyed by currency code';
  }
  const out: PriceMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cur = String(k).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw `invalid currency code: ${k}`;
    const obj = v as { monthly?: unknown; yearly?: unknown } | undefined;
    const monthly = Number(obj?.monthly ?? 0);
    const yearly = Number(obj?.yearly ?? 0);
    if (!Number.isFinite(monthly) || monthly < 0) throw `invalid monthly price for ${cur}`;
    if (!Number.isFinite(yearly) || yearly < 0) throw `invalid yearly price for ${cur}`;
    out[cur] = { monthly: Math.round(monthly), yearly: Math.round(yearly) };
  }
  if (Object.keys(out).length === 0) throw 'prices must contain at least one currency';
  return out;
}

/**
 * GET /api/v1/admin/plans
 *
 * Returns all plans (including inactive) with the count of subscriptions
 * referencing each. The count drives the UI's delete-affordance: zero
 * subs → safe to delete; >0 → only "deactivate" makes sense.
 */
export const listAdminPlans = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { subscriptions: true } },
      },
    });
    ApiResponse.success(
      res,
      plans.map((p) => ({
        ...p,
        subscriptionCount: p._count.subscriptions,
        _count: undefined,
      }))
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/admin/plans
 * Body: { slug, name, description?, prices, maxProjects?, maxMembers?,
 *         features?, displayOrder?, isActive?, isCustom? }
 */
export const createAdminPlan = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body = req.body as {
      slug?: string;
      name?: string;
      description?: string;
      prices?: unknown;
      maxProjects?: number | null;
      maxMembers?: number | null;
      features?: string[];
      displayOrder?: number;
      isActive?: boolean;
      isCustom?: boolean;
    };

    const slug = String(body.slug || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    if (!slug || !SLUG_REGEX.test(slug)) {
      ApiResponse.badRequest(res, 'slug requis (lettres minuscules, chiffres, - et _)');
      return;
    }
    if (!name) {
      ApiResponse.badRequest(res, 'name requis');
      return;
    }

    let prices: PriceMap;
    try {
      prices = validatePrices(body.prices);
    } catch (msg) {
      ApiResponse.badRequest(res, String(msg));
      return;
    }

    const existing = await prisma.subscriptionPlan.findUnique({ where: { slug } });
    if (existing) {
      ApiResponse.conflict(res, `Un plan avec le slug "${slug}" existe déjà.`);
      return;
    }

    const plan = await prisma.subscriptionPlan.create({
      data: {
        slug,
        name,
        description: body.description?.trim() || null,
        prices: prices as object,
        maxProjects: body.maxProjects ?? null,
        maxMembers: body.maxMembers ?? null,
        features: Array.isArray(body.features)
          ? body.features.map((f) => String(f).trim()).filter(Boolean)
          : [],
        displayOrder: Number.isFinite(body.displayOrder) ? Number(body.displayOrder) : 0,
        isActive: body.isActive !== false,
        isCustom: !!body.isCustom,
      },
    });

    auditLogFromRequest(req, 'SUBSCRIPTION_PLAN_CREATE', {
      targetType: 'subscription_plan' as any,
      targetId: plan.id,
      metadata: { slug, name },
    });

    ApiResponse.created(res, plan, 'Plan créé');
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/admin/plans/:id
 * Body: any subset of the create fields (slug stays immutable to avoid
 *       breaking external links / tests / FK-by-slug callers).
 */
export const updateAdminPlan = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      prices?: unknown;
      maxProjects?: number | null;
      maxMembers?: number | null;
      features?: string[];
      displayOrder?: number;
      isActive?: boolean;
      isCustom?: boolean;
    };

    const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!existing) {
      ApiResponse.notFound(res, 'Plan introuvable');
      return;
    }

    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.description === 'string') {
      data.description = body.description.trim() || null;
    }
    if (body.prices !== undefined) {
      try {
        data.prices = validatePrices(body.prices) as object;
      } catch (msg) {
        ApiResponse.badRequest(res, String(msg));
        return;
      }
    }
    if (body.maxProjects === null || typeof body.maxProjects === 'number') {
      data.maxProjects = body.maxProjects;
    }
    if (body.maxMembers === null || typeof body.maxMembers === 'number') {
      data.maxMembers = body.maxMembers;
    }
    if (Array.isArray(body.features)) {
      data.features = body.features.map((f) => String(f).trim()).filter(Boolean);
    }
    if (typeof body.displayOrder === 'number') data.displayOrder = body.displayOrder;
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (typeof body.isCustom === 'boolean') data.isCustom = body.isCustom;

    if (Object.keys(data).length === 0) {
      ApiResponse.badRequest(res, 'Aucun champ à modifier');
      return;
    }

    const plan = await prisma.subscriptionPlan.update({ where: { id }, data });

    auditLogFromRequest(req, 'SUBSCRIPTION_PLAN_UPDATE', {
      targetType: 'subscription_plan' as any,
      targetId: id,
      metadata: { slug: existing.slug, changes: Object.keys(data) },
    });

    ApiResponse.success(res, plan, 'Plan mis à jour');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/admin/plans/:id
 *
 * Refuses if any subscription still references the plan — the admin
 * should mark it inactive and migrate subscribers first. We surface
 * 409 with the count so the UI can show "5 équipes utilisent ce plan,
 * désactivez-le d'abord".
 */
export const deleteAdminPlan = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Plan introuvable');
      return;
    }
    if (existing._count.subscriptions > 0) {
      ApiResponse.conflict(
        res,
        `Ce plan est utilisé par ${existing._count.subscriptions} équipe(s). Désactivez-le et migrez les abonnés avant suppression.`
      );
      return;
    }

    await prisma.subscriptionPlan.delete({ where: { id } });

    auditLogFromRequest(req, 'SUBSCRIPTION_PLAN_DELETE', {
      targetType: 'subscription_plan' as any,
      targetId: id,
      metadata: { slug: existing.slug, name: existing.name },
    });

    ApiResponse.success(res, null, 'Plan supprimé');
  } catch (err) {
    next(err);
  }
};
