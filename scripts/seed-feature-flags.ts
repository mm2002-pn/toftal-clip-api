/**
 * Seed the FeatureFlag table with all the flags the codebase currently
 * references (or will reference as we migrate hardcoded toggles). Idempotent —
 * re-running only creates missing entries, never overrides existing ones.
 *
 * Usage:
 *   npm run seed:feature-flags
 *   npm run seed:feature-flags -- --reset   # reset every flag to its default value
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const resetMode = process.argv.includes('--reset');

// Each flag: { name, description, defaultEnabled }
// Defaults mirror current production behavior — no flag flips state on seed.
const FLAGS: { name: string; description: string; enabled: boolean }[] = [
  // Feedback features (currently on everywhere)
  { name: 'voice_notes', description: 'Enregistrements vocaux dans les feedbacks', enabled: true },
  { name: 'emoji_reactions', description: 'Réactions emoji (WhatsApp-style) sur les feedbacks', enabled: true },
  { name: 'drawing_annotations', description: 'Annotations dessinées sur la vidéo', enabled: true },

  // Upload features
  { name: 'tus_upload', description: 'Upload résumable (TUS) pour les grosses vidéos', enabled: false },

  // AI features (currently on, but useful to kill-switch)
  { name: 'ai_brief_optimization', description: 'Optimisation automatique du brief projet par IA', enabled: true },
  { name: 'ai_video_analysis', description: 'Analyse IA des versions vidéo (score, points forts/faibles)', enabled: true },
  { name: 'ai_task_generation', description: 'Génération auto de tâches depuis les feedbacks', enabled: true },
  { name: 'ai_rephrase', description: 'Reformulation IA des textes', enabled: true },

  // Legacy / disabled features
  { name: 'talent_mode', description: 'Mode talent / marketplace freelance (legacy)', enabled: false },
  { name: 'opportunities_module', description: 'Module Opportunités (legacy)', enabled: false },
  { name: 'studios_module', description: 'Module Studios (legacy)', enabled: false },

  // UI experiments
  { name: 'shorts_layout_v2', description: 'Nouveau layout 9:16 desktop (menu contextuel + barre latérale)', enabled: true },
  { name: 'skeleton_loader', description: 'Skeleton YouTube-style au chargement des projets', enabled: true },

  // Observability
  { name: 'sentry_enabled', description: 'Envoi des erreurs à Sentry', enabled: true },

  // Billing / subscriptions
  {
    name: 'subscription_free_trial_enabled',
    description: 'Active le free trial (14 jours) avant le premier paiement Bictorys',
    enabled: false,
  },
];

async function main() {
  console.log(`🌱 Seeding ${FLAGS.length} feature flags (reset=${resetMode})…`);

  let created = 0;
  let skipped = 0;
  let reset = 0;

  for (const flag of FLAGS) {
    const existing = await prisma.featureFlag.findUnique({ where: { name: flag.name } });

    if (!existing) {
      await prisma.featureFlag.create({
        data: {
          name: flag.name,
          description: flag.description,
          enabled: flag.enabled,
        },
      });
      console.log(`   + created ${flag.name} (enabled=${flag.enabled})`);
      created++;
    } else if (resetMode) {
      await prisma.featureFlag.update({
        where: { name: flag.name },
        data: { enabled: flag.enabled, description: flag.description },
      });
      console.log(`   ↺ reset ${flag.name} → enabled=${flag.enabled}`);
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
