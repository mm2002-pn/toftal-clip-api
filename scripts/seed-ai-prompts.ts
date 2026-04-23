/**
 * Seed initial AI prompt templates extracted from src/modules/ai/services/index.ts.
 *
 * These power the six AI-assisted flows in the product. Storing them in the
 * DB lets you tune prompts (rewording, temperature, target model) without
 * redeploying — useful when you're iterating on prompt engineering.
 *
 * Idempotent: only creates entries that don't exist. Use --reset to
 * overwrite existing ones.
 *
 * Usage:
 *   npm run seed:ai-prompts
 *   npm run seed:ai-prompts -- --reset
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const resetMode = process.argv.includes('--reset');

interface AIPrompt {
  name: string;
  description: string;
  model: string;
  systemPrompt: string | null;
  userPromptTemplate: string;
  temperature: number;
  maxTokens: number | null;
  responseFormat: 'json' | 'text';
  variables: string[];
}

const PROMPTS: AIPrompt[] = [
  {
    name: 'brief_optimization',
    description: "Génère/reformule un brief créatif à partir des infos projet",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un directeur de création expert spécialisé dans le contenu vidéo pour les réseaux sociaux.
Tu dois analyser des briefs créatifs et générer des recommandations stratégiques en français.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Tu es un directeur de création expert.
Génère un brief créatif structuré pour ce projet vidéo.

Contexte:
Projet: {{objective}}
Type: {{contentType}}
Audience: {{targetAudience}}
Ton: {{tone}}

Retourne un objet JSON avec (tout en français) :
- aiSummary (string): Un résumé stratégique concis.
- aiStructure (array of strings): Structure narrative recommandée.
- aiHook (string): Une accroche (hook) suggérée pour arrêter le scroll.
- aiKeyPoints (array of strings): 3-5 points créatifs clés à respecter.

Retourne:
{
  "aiSummary": "Résumé stratégique en 1-2 phrases",
  "aiStructure": ["Phase 1", "Phase 2", "Phase 3"],
  "aiHook": "Une accroche percutante pour arrêter le scroll",
  "aiKeyPoints": ["Point 1", "Point 2", "Point 3"]
}`,
    temperature: 0.7,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['objective', 'contentType', 'targetAudience', 'tone'],
  },

  {
    name: 'brief_rephrase',
    description: "Reformule un brief existant pour le rendre plus professionnel",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un directeur de création expert spécialisé dans le contenu vidéo.
Tu reformules et améliores des briefs créatifs pour les rendre plus professionnels, clairs et actionnables.
Garde l'intention originale mais améliore la clarté, la structure et le professionnalisme.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Reformule et améliore ce brief créatif pour le projet "{{objective}}".

Brief original à reformuler:
"{{existingBrief}}"

Instructions:
- Garde l'intention et les idées principales du brief original
- Reformule de manière plus professionnelle et structurée
- Ajoute des précisions si le brief est vague
- Le résultat doit être actionnable pour un vidéaste

Retourne un objet JSON avec:
- aiSummary (string): Le brief reformulé (2-4 phrases professionnelles)
- aiStructure (array of strings): Structure narrative suggérée (3-5 phases)
- aiHook (string): Une accroche suggérée basée sur le brief
- aiKeyPoints (array of strings): 3-5 points clés à respecter`,
    temperature: 0.5,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['objective', 'existingBrief'],
  },

  {
    name: 'video_analysis',
    description: "Analyse automatique d'une version vidéo (score + points forts/faibles)",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un expert en analyse de contenu vidéo pour les réseaux sociaux.
Tu analyses des vidéos et fournis un feedback structuré, objectif et actionnable.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Analyse cette description de vidéo et fournis un feedback créatif détaillé en français.

Description de la vidéo:
"{{description}}"

Retourne un objet JSON avec:
- score (number 0-100): Score global de qualité
- strengths (array of strings): 3-5 points forts
- weaknesses (array of strings): 3-5 points faibles
- suggestions (array of strings): 3-5 suggestions concrètes d'amélioration
- engagementPrediction (string): Prédiction d'engagement (low/medium/high) avec justification courte`,
    temperature: 0.6,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['description'],
  },

  {
    name: 'task_generation',
    description: "Extrait des tâches actionnables depuis un feedback client",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un assistant qui transforme les retours clients en tâches techniques pour un vidéaste.
Les tâches doivent être courtes, claires, actionnables et au mode impératif.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Analyse ce feedback client et extrait la liste des modifications à apporter à la vidéo.

Feedback client:
"{{feedbackText}}"

Retourne un objet JSON avec:
- structuredText (string): Le feedback reformulé de manière structurée et professionnelle
- tasks (array of { description: string }): Liste de tâches concrètes (1 tâche = 1 action)

Exemple:
{
  "structuredText": "Le client demande de raccourcir l'intro et d'ajuster la musique.",
  "tasks": [
    { "description": "Raccourcir l'intro de 5s à 2s" },
    { "description": "Baisser le volume de la musique à partir de 0:15" }
  ]
}`,
    temperature: 0.4,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['feedbackText'],
  },

  {
    name: 'content_rephrase',
    description: "Reformule un texte en 3 variations stylistiques",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un copywriter professionnel.
Tu proposes plusieurs reformulations d'un même texte avec des tons différents.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Reformule ce texte en 3 variations (formelle, concise, engageante).

Texte original:
"{{text}}"

Retourne un tableau JSON de 3 strings.`,
    temperature: 0.7,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['text'],
  },

  {
    name: 'talent_matching',
    description: "Score de matching entre un brief et une liste de talents (legacy)",
    model: 'groq:llama-3.3-70b-versatile',
    systemPrompt: `Tu es un expert en matching talent pour projets vidéo.
Tu analyses un brief + une liste de talents et tu scores chacun selon sa pertinence.
Réponds UNIQUEMENT en JSON valide.`,
    userPromptTemplate: `Brief du projet:
{{briefSummary}}

Type de contenu: {{contentType}}
Audience cible: {{targetAudience}}

Talents disponibles:
{{talentsJson}}

Retourne un tableau JSON avec { id, matchScore (0-100), reason } pour chaque talent.`,
    temperature: 0.5,
    maxTokens: null,
    responseFormat: 'json',
    variables: ['briefSummary', 'contentType', 'targetAudience', 'talentsJson'],
  },
];

async function main() {
  console.log(`🤖 Seeding ${PROMPTS.length} AI prompt templates (reset=${resetMode})…`);

  let created = 0;
  let reset = 0;
  let skipped = 0;

  for (const p of PROMPTS) {
    const existing = await prisma.aIPromptTemplate.findUnique({ where: { name: p.name } });

    if (!existing) {
      await prisma.aIPromptTemplate.create({ data: p });
      console.log(`   + created ${p.name}`);
      created++;
    } else if (resetMode) {
      await prisma.aIPromptTemplate.update({
        where: { name: p.name },
        data: p,
      });
      console.log(`   ↺ reset ${p.name}`);
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
