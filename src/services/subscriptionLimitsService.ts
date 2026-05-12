/**
 * Subscription enforcement — runs in front of every write that touches a
 * team-scoped resource (project create, member add, etc.). Two concerns:
 *
 *   1. **Workspace status gate** — only orgs with `status = ACTIVE` (paid
 *      or trialing) can be written to. DRAFT orgs are pre-payment and
 *      shouldn't be visible to the user yet. SUSPENDED orgs are existing
 *      teams that need to subscribe (post-paywall migration backfilled
 *      every existing org to SUSPENDED) — they can read their data but
 *      not create new resources.
 *
 *   2. **Plan limits** — current count vs `plan.maxProjects` /
 *      `plan.maxMembers`. `null` on the plan = illimité.
 *
 * Helpers throw `BadRequestError` with a user-facing French message so
 * controllers can `catch` them as-is and the frontend can surface them
 * in a toast.
 *
 * Free trial: gated behind feature flag `subscription_free_trial_enabled`.
 * When enabled, `startTrialForOrg` is called instead of the regular
 * Bictorys checkout — skip the charge, set `status = TRIALING` with
 * `trialEndsAt = now + 14d`, flip the org to ACTIVE so the user can
 * actually use it. After the trial expires (cron), status flips to
 * `PAST_DUE` and we re-prompt for payment.
 */

import { prisma } from '../config/database';
import { BadRequestError, ForbiddenError } from '../utils/errors';

const TRIAL_DAYS = 14;

/**
 * The minimum subscription state for write access. ACTIVE = paid or
 * trialing. PAST_DUE is read-only (we still let renewals retry but the
 * user can't add more projects/members until they pay). SUSPENDED is
 * also read-only.
 */
function isWorkspaceWritable(orgStatus: string, subStatus?: string | null): boolean {
  if (orgStatus !== 'ACTIVE') return false;
  if (!subStatus) return false;
  return subStatus === 'ACTIVE' || subStatus === 'TRIALING';
}

/**
 * Returns the org+plan+sub triple needed by the limit checks. Throws if
 * the org doesn't exist OR the caller asked for a limit on an org that
 * isn't writable.
 */
async function loadOrgForLimits(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      status: true,
      subscription: { include: { plan: true } },
    },
  });
  if (!org) throw new BadRequestError("Équipe introuvable.");
  return org;
}

/**
 * Generic gate — throws if writes shouldn't be accepted on the org.
 * Personal projects (organizationId === null) bypass entirely; the Solo
 * scope is free at launch.
 */
export async function assertOrgWritable(organizationId: string | null | undefined): Promise<void> {
  if (!organizationId) return;
  const org = await loadOrgForLimits(organizationId);
  if (!isWorkspaceWritable(org.status, org.subscription?.status)) {
    if (org.status === 'SUSPENDED' || org.subscription?.status === 'PAST_DUE') {
      throw new ForbiddenError(
        "Votre équipe est suspendue. Souscrivez un plan pour continuer."
      );
    }
    if (org.status === 'DRAFT') {
      throw new ForbiddenError(
        "Le paiement de votre équipe n'a pas été finalisé. Réessayez le checkout."
      );
    }
    throw new ForbiddenError("Équipe non active.");
  }
}

/**
 * Project-creation gate. Combines the writability check with the plan's
 * `maxProjects` cap. Skips for personal projects (no orgId).
 */
export async function assertCanCreateProject(
  organizationId: string | null | undefined
): Promise<void> {
  if (!organizationId) return;
  const org = await loadOrgForLimits(organizationId);
  if (!isWorkspaceWritable(org.status, org.subscription?.status)) {
    throw new ForbiddenError(
      "Votre équipe ne peut pas créer de projets actuellement (paiement requis)."
    );
  }
  const max = org.subscription?.plan.maxProjects;
  if (max !== null && max !== undefined) {
    const count = await prisma.project.count({
      where: { organizationId, deletedAt: null },
    });
    if (count >= max) {
      throw new BadRequestError(
        `Vous avez atteint la limite de ${max} projets de votre plan. Passez à l'offre supérieure.`
      );
    }
  }
}

/**
 * Member-addition gate. Same shape as `assertCanCreateProject` but
 * checks `maxMembers`. Includes the inviter so we don't double-count.
 */
export async function assertCanAddMember(
  organizationId: string,
  countToAdd: number = 1
): Promise<void> {
  const org = await loadOrgForLimits(organizationId);
  if (!isWorkspaceWritable(org.status, org.subscription?.status)) {
    throw new ForbiddenError(
      "Votre équipe ne peut pas ajouter de membres actuellement (paiement requis)."
    );
  }
  const max = org.subscription?.plan.maxMembers;
  if (max !== null && max !== undefined) {
    const current = await prisma.organizationMember.count({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (current + countToAdd > max) {
      throw new BadRequestError(
        `Limite de ${max} membres atteinte sur votre plan. Passez à l'offre supérieure pour ajouter plus.`
      );
    }
  }
}

/**
 * Feature presence check. Plans store features as a string array
 * (`['voice_memos', 'ia_magic', ...]`). Falls back to `false` if no
 * subscription — that way the gate is permissive for personal use
 * cases that aren't org-scoped.
 */
export async function orgHasFeature(
  organizationId: string | null | undefined,
  featureKey: string
): Promise<boolean> {
  if (!organizationId) return true; // personal scope: ungated for now
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscription: { include: { plan: true } } },
  });
  return !!org?.subscription?.plan.features.includes(featureKey);
}

/**
 * Free-trial entry point — called by the checkout controller when the
 * `subscription_free_trial_enabled` feature flag is on AND the user
 * picked a non-custom plan. Skips the Bictorys charge entirely.
 *
 * Returns the orgId so the controller can include it in the response.
 */
export async function startTrialForOrg(
  organizationId: string,
  subscriptionId: string
): Promise<void> {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'TRIALING',
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        nextBillingAt: trialEndsAt,
      },
    }),
    prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'ACTIVE' },
    }),
  ]);
}

/**
 * Cheap helper to check the trial flag from controllers.
 */
export async function isFreeTrialEnabled(): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({
    where: { name: 'subscription_free_trial_enabled' },
    select: { enabled: true },
  });
  return !!flag?.enabled;
}

/**
 * Janitor — deletes Organisation rows that were left in DRAFT status
 * for more than `maxAgeHours` hours (default 24h). Called by an admin
 * cron OR from a manual admin endpoint until the cron lands. Prisma
 * cascades the delete onto OrganizationMember + Subscription + Payment
 * thanks to onDelete: Cascade.
 *
 * Returns the count for logging.
 */
export async function reapStaleDrafts(maxAgeHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const { count } = await prisma.organization.deleteMany({
    where: {
      status: 'DRAFT',
      createdAt: { lt: cutoff },
    },
  });
  return count;
}
