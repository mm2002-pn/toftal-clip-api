/**
 * Seed the subscription plans (Équipe / Agence / Entreprise).
 *
 * Pricing comes from the launch deck — XOF only at v1; the schema's
 * `prices` JSON keeps the door open for XAF / EUR later. Limits are
 * encoded so the limits service can enforce them dynamically.
 *
 * The "Solo" tier exists in the marketing site but Solo workspaces stay
 * free at launch (per product call), so it is NOT seeded here.
 *
 * "Entreprise" is `isCustom: true` — the frontend skips self-checkout
 * and routes to a contact-sales CTA instead.
 *
 * Idempotent: only inserts plans that don't exist yet (matched by slug).
 * Use --reset to overwrite every field of every existing plan.
 *
 * Usage:
 *   npm run seed:subscription-plans
 *   npm run seed:subscription-plans -- --reset
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const resetMode = process.argv.includes('--reset');

interface PlanSeed {
  slug: string;
  name: string;
  description: string;
  /** Prices in the smallest currency unit (XOF has no minor unit → 19900 = 19 900 F). */
  prices: { XOF: { monthly: number; yearly: number } };
  /** null = illimité */
  maxProjects: number | null;
  maxMembers: number | null;
  features: string[];
  displayOrder: number;
  isCustom: boolean;
}

// Yearly = the up-front charge for 12 months. The "X FCFA / mois" shown on
// the pricing page when the user picks annual = yearly / 12 (UI math, the
// transaction is the yearly figure).
const PLANS: PlanSeed[] = [
  {
    slug: 'team',
    name: 'Équipe',
    description: 'Pour les petites équipes qui collaborent.',
    prices: {
      XOF: {
        monthly: 19_900,
        yearly: 119_400, // = 9 950 × 12
      },
    },
    maxProjects: 30,
    maxMembers: 5,
    features: [
      'unlimited_client_reviewers',
      'timecodes_annotations',
      'ia_magic',
      'public_share',
      'voice_memos',
      'version_management',
      'email_invitations',
    ],
    displayOrder: 10,
    isCustom: false,
  },
  {
    slug: 'agency',
    name: 'Agence',
    description: 'Pour les agences avec un volume important.',
    prices: {
      XOF: {
        monthly: 39_900,
        yearly: 239_400, // = 19 950 × 12
      },
    },
    maxProjects: null,
    maxMembers: null,
    features: [
      'unlimited_client_reviewers',
      'timecodes_annotations',
      'ia_magic',
      'public_share',
      'voice_memos',
      'version_management',
      'email_invitations',
      'priority_support',
      'dedicated_onboarding',
      'advanced_analytics',
    ],
    displayOrder: 20,
    isCustom: false,
  },
  {
    slug: 'enterprise',
    name: 'Entreprise',
    description: 'Sur mesure — volumes et besoins spécifiques.',
    // Custom plans don't go through self-checkout; we still store the
    // price object for consistency but flag it as 0 / "contact us" in UI.
    prices: { XOF: { monthly: 0, yearly: 0 } },
    maxProjects: null,
    maxMembers: null,
    features: [
      'unlimited_client_reviewers',
      'timecodes_annotations',
      'ia_magic',
      'public_share',
      'voice_memos',
      'version_management',
      'email_invitations',
      'priority_support',
      'dedicated_onboarding',
      'advanced_analytics',
      'sla_guaranteed',
      'custom_integrations',
      'custom_billing',
      'dedicated_account_manager',
    ],
    displayOrder: 30,
    isCustom: true,
  },
];

async function main() {
  console.log(`🌱 Seeding ${PLANS.length} subscription plans (reset=${resetMode})…`);

  let created = 0;
  let skipped = 0;
  let reset = 0;

  for (const plan of PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { slug: plan.slug } });

    if (!existing) {
      await prisma.subscriptionPlan.create({
        data: {
          slug: plan.slug,
          name: plan.name,
          description: plan.description,
          prices: plan.prices,
          maxProjects: plan.maxProjects,
          maxMembers: plan.maxMembers,
          features: plan.features,
          displayOrder: plan.displayOrder,
          isActive: true,
          isCustom: plan.isCustom,
        },
      });
      console.log(`   + created ${plan.slug} (${plan.name})`);
      created++;
    } else if (resetMode) {
      await prisma.subscriptionPlan.update({
        where: { slug: plan.slug },
        data: {
          name: plan.name,
          description: plan.description,
          prices: plan.prices,
          maxProjects: plan.maxProjects,
          maxMembers: plan.maxMembers,
          features: plan.features,
          displayOrder: plan.displayOrder,
          isCustom: plan.isCustom,
        },
      });
      console.log(`   ↺ reset ${plan.slug}`);
      reset++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ Done — created=${created} reset=${reset} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
