import { config } from '../../../config';
import { chatCompletionJSON, chatCompletion, transcribeAudio as groqTranscribe } from '../../../config/groq';
import { logger } from '../../../utils/logger';
import { prisma } from '../../../config/database';
import { renderAIPromptFromDB } from '../../../services/templateResolver';

/**
 * Try to build the messages[] array + model config from a DB-backed prompt
 * template. Returns null if the template isn't in the DB, letting the caller
 * fall back to its inline hardcoded messages.
 *
 * The `model` field on AIPromptTemplate uses the format "provider:model" (e.g.
 * "groq:llama-3.3-70b-versatile"). Only the part after ":" is passed to the
 * Groq client — the provider prefix is informational for now.
 */
const buildPromptFromDB = async (
  name: string,
  vars: Record<string, unknown>
): Promise<{ messages: Array<{ role: 'system' | 'user'; content: string }>; model: string; temperature: number } | null> => {
  const rendered = await renderAIPromptFromDB(name, vars);
  if (!rendered) return null;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (rendered.systemPrompt) messages.push({ role: 'system', content: rendered.systemPrompt });
  messages.push({ role: 'user', content: rendered.userPrompt });

  const model = rendered.model.includes(':') ? rendered.model.split(':')[1] : rendered.model;
  return { messages, model, temperature: rendered.temperature };
};

// ============================================
// Types
// ============================================

interface BriefOptimization {
  aiSummary: string;
  aiStructure: string[];
  aiHook: string;
  aiKeyPoints: string[];
}

interface TalentMatch {
  id: string;
  matchScore: number;
  reason: string;
}

interface VideoAnalysis {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  engagementPrediction: string;
}

interface TaskGeneration {
  structuredText: string;
  tasks: { description: string }[];
}

// ============================================
// Brief Optimization
// ============================================

export const optimizeBrief = async (brief: any): Promise<BriefOptimization> => {
  console.log('=== GROQ DEBUG ===');
  console.log('API Key exists:', !!config.groq.apiKey);
  console.log('API Key prefix:', config.groq.apiKey?.substring(0, 10));
  console.log('==================');

  if (!config.groq.apiKey) {
    console.log('Returning MOCK data (no API key)');
    return {
      aiSummary: "Une vidéo dynamique ciblant la Gen Z pour booster la notoriété de la marque.",
      aiStructure: ["Intro: Accroche de 0-3s", "Corps: Problème & Solution", "CTA: Swipe Up"],
      aiHook: "Arrêtez de scroller ! Vous devez voir ça.",
      aiKeyPoints: ["Authenticité", "Rythme rapide", "Branding clair"]
    };
  }

  console.log('Calling REAL Groq API...');

  try {
    // Determine if we're reformulating existing text or generating from scratch
    const hasExistingBrief = brief.aiSummary && brief.aiSummary.trim().length > 10;

    // Try DB-backed prompt first. Two distinct names for the two flows so
    // admins can tune each independently.
    const dbPrompt = await buildPromptFromDB(
      hasExistingBrief ? 'brief_rephrase' : 'brief_optimization',
      {
        objective: brief.objective || 'Non spécifié',
        contentType: brief.contentType || 'Non spécifié',
        targetAudience: brief.targetAudience || 'Non spécifié',
        tone: brief.tone || 'Non spécifié',
        existingBrief: brief.aiSummary || '',
      }
    );
    if (dbPrompt) {
      return await chatCompletionJSON<BriefOptimization>(dbPrompt.messages, {
        model: dbPrompt.model || config.groq.models.powerful,
        temperature: dbPrompt.temperature,
      });
    }

    const systemPrompt = hasExistingBrief
      ? `Tu es un directeur de création expert spécialisé dans le contenu vidéo.
Tu reformules et améliores des briefs créatifs pour les rendre plus professionnels, clairs et actionnables.
Garde l'intention originale mais améliore la clarté, la structure et le professionnalisme.
Réponds UNIQUEMENT en JSON valide.`
      : `Tu es un directeur de création expert spécialisé dans le contenu vidéo pour les réseaux sociaux.
Tu dois analyser des briefs créatifs et générer des recommandations stratégiques en français.
Réponds UNIQUEMENT en JSON valide.`;

    const userPrompt = hasExistingBrief
      ? `Reformule et améliore ce brief créatif pour le projet "${brief.objective || 'Projet vidéo'}".

Brief original à reformuler:
"${brief.aiSummary}"

Instructions:
- Garde l'intention et les idées principales du brief original
- Reformule de manière plus professionnelle et structurée
- Ajoute des précisions si le brief est vague
- Le résultat doit être actionnable pour un vidéaste

Retourne un objet JSON avec:
- aiSummary (string): Le brief reformulé (2-4 phrases professionnelles)
- aiStructure (array of strings): Structure narrative suggérée (3-5 phases)
- aiHook (string): Une accroche suggérée basée sur le brief
- aiKeyPoints (array of strings): 3-5 points clés à respecter

Retourne:
{
  "aiSummary": "Brief reformulé professionnel",
  "aiStructure": ["Phase 1", "Phase 2", "Phase 3"],
  "aiHook": "Accroche percutante",
  "aiKeyPoints": ["Point 1", "Point 2", "Point 3"]
}`
      : `Tu es un directeur de création expert.
Génère un brief créatif structuré pour ce projet vidéo.

Contexte:
Projet: ${brief.objective || 'Non spécifié'}
Type: ${brief.contentType || 'Non spécifié'}
Audience: ${brief.targetAudience || 'Non spécifié'}
Ton: ${brief.tone || 'Non spécifié'}

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
}`;

    const result = await chatCompletionJSON<BriefOptimization>([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { model: config.groq.models.powerful });

    return result;
  } catch (error) {
    logger.error('AI Brief Optimization Error:', error);
    throw error;
  }
};

// ============================================
// Talent Matching
// ============================================

export const matchTalents = async (brief: any): Promise<TalentMatch[]> => {
  if (!config.groq.apiKey) {
    return [
      { id: 't1', matchScore: 98, reason: "Excellent fit pour le format court." },
      { id: 't2', matchScore: 85, reason: "Bonne maîtrise du storytelling." },
    ];
  }

  try {
    // Get available talents from DB
    const talents = await prisma.talentProfile.findMany({
      include: { user: { select: { id: true, name: true } } },
      take: 20,
    });

    if (talents.length === 0) {
      return [];
    }

    const talentList = talents.map(t => ({
      id: t.id,
      name: t.user.name,
      skills: t.skills,
      videoType: t.videoType,
      rating: t.rating,
    }));

    const dbPrompt = await buildPromptFromDB('talent_matching', {
      briefSummary: brief.aiSummary || brief.objective || '',
      contentType: brief.contentType || '',
      targetAudience: brief.targetAudience || '',
      talentsJson: JSON.stringify(talentList, null, 2),
    });
    if (dbPrompt) {
      const r = await chatCompletionJSON<{ matches: TalentMatch[] }>(dbPrompt.messages, {
        model: dbPrompt.model || config.groq.models.powerful,
        temperature: dbPrompt.temperature,
      });
      return r.matches || [];
    }

    const result = await chatCompletionJSON<{ matches: TalentMatch[] }>([
      {
        role: 'system',
        content: `Tu es un chasseur de têtes expert pour les créatifs vidéo.
Tu dois matcher les talents avec les projets en fonction de leurs compétences.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Tu es un agent de talents (chasseur de tête).
Voici le brief du projet : ${JSON.stringify(brief, null, 2)}

Voici une liste de talents disponibles : ${JSON.stringify(talentList, null, 2)}

Sélectionne les 3 meilleurs talents pour ce projet.
Pour chacun, attribue un score de correspondance (0-100) et écris une raison courte (1 phrase en français) expliquant pourquoi ils correspondent.

Retourne:
{
  "matches": [
    { "id": "talent_id", "matchScore": 85, "reason": "Raison courte en français" }
  ]
}`
      }
    ], { model: config.groq.models.powerful });

    return result.matches || [];
  } catch (error) {
    logger.error('AI Talent Matching Error:', error);
    throw error;
  }
};

// ============================================
// Video Analysis
// ============================================

export const analyzeVideo = async (description: string): Promise<VideoAnalysis> => {
  if (!config.groq.apiKey) {
    return {
      score: 88,
      strengths: ["Bon rythme", "CTA clair"],
      weaknesses: ["Éclairage sombre"],
      suggestions: ["Augmenter l'exposition", "Ajouter des sous-titres"],
      engagementPrediction: "Fort potentiel de rétention."
    };
  }

  try {
    const dbPrompt = await buildPromptFromDB('video_analysis', { description });
    if (dbPrompt) {
      return await chatCompletionJSON<VideoAnalysis>(dbPrompt.messages, {
        model: dbPrompt.model || config.groq.models.powerful,
        temperature: dbPrompt.temperature,
      });
    }

    const result = await chatCompletionJSON<VideoAnalysis>([
      {
        role: 'system',
        content: `Tu es un expert en analyse de contenu vidéo pour les réseaux sociaux.
Tu évalues les vidéos selon leur potentiel d'engagement.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Analyse ce concept/script/description de vidéo pour son efficacité sur les réseaux sociaux.
Réponds en français.
Description: "${description}"

Retourne:
{
  "score": 0-100,
  "strengths": ["point fort 1", "point fort 2"],
  "weaknesses": ["point faible 1"],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "engagementPrediction": "Prédiction courte"
}`
      }
    ], { model: config.groq.models.powerful });

    return result;
  } catch (error) {
    logger.error('AI Video Analysis Error:', error);
    throw error;
  }
};

// ============================================
// Audio Transcription (Whisper)
// ============================================

export const transcribeAudio = async (audioBase64: string, mimeType: string = 'audio/webm'): Promise<string> => {
  if (!config.groq.apiKey) {
    return "Transcription simulée: La musique est un peu trop forte au début.";
  }

  try {
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const transcription = await groqTranscribe(audioBuffer, mimeType);
    return transcription;
  } catch (error) {
    logger.error('Transcription Error:', error);
    throw error;
  }
};

// ============================================
// Generate Tasks from Feedback
// ============================================

export const generateTasks = async (feedbackText: string): Promise<TaskGeneration> => {
  if (!config.groq.apiKey) {
    return {
      structuredText: "Le retour demande des ajustements sur l'intro et les sous-titres.",
      tasks: [
        { description: "Couper l'intro à moins de 3 secondes" },
        { description: "Augmenter la taille des sous-titres de 20%" },
      ]
    };
  }

  try {
    const dbPrompt = await buildPromptFromDB('task_generation', { feedbackText });
    if (dbPrompt) {
      return await chatCompletionJSON<TaskGeneration>(dbPrompt.messages, {
        model: dbPrompt.model || config.groq.models.fast,
        temperature: dbPrompt.temperature,
      });
    }

    const result = await chatCompletionJSON<TaskGeneration>([
      {
        role: 'system',
        content: `Tu es un chef de projet vidéo.
Tu transformes les retours clients en tâches actionnables pour les monteurs.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Tu es un responsable de production vidéo professionnel.
Analyse le retour client suivant (qui peut être brut, conversationnel ou une transcription).

1. Résume-le en un paragraphe poli et structuré en français.
2. Extrais des tâches spécifiques et actionnables pour le monteur vidéo (en français).

Feedback: "${feedbackText}"

Retourne:
{
  "structuredText": "Version structurée et professionnelle du feedback",
  "tasks": [
    { "description": "Tâche spécifique et actionnable 1" },
    { "description": "Tâche spécifique et actionnable 2" }
  ]
}`
      }
    ], { model: config.groq.models.fast });

    return result;
  } catch (error) {
    logger.error('AI Task Generation Error:', error);
    throw error;
  }
};

// ============================================
// Rephrase Content
// ============================================

export const rephraseContent = async (text: string): Promise<string[]> => {
  if (!config.groq.apiKey) {
    return [text];
  }

  try {
    // Extract timestamp from the text if present
    const timestampMatch = text.match(/\[?\d{1,2}:\d{2}\]?/);
    const timestamp = timestampMatch ? timestampMatch[0] : '';

    // For content_rephrase, the DB template returns a JSON array of strings.
    // We keep the chatCompletion (raw string) path as fallback when there's
    // no DB entry — it returns 3 lines separated by \n.
    const dbPrompt = await buildPromptFromDB('content_rephrase', { text });
    if (dbPrompt) {
      try {
        const arr = await chatCompletionJSON<string[]>(dbPrompt.messages, {
          model: dbPrompt.model || config.groq.models.fast,
          temperature: dbPrompt.temperature,
        });
        return Array.isArray(arr) ? arr : [text];
      } catch {
        // fall through to the raw-text path
      }
    }

    const result = await chatCompletion([
      {
        role: 'system',
        content: `Tu es un assistant qui reformule des commentaires de feedback vidéo de manière professionnelle et concise.

RÈGLES STRICTES:
1. Retourne EXACTEMENT 3 reformulations, une par ligne
2. AUCUN numéro, tiret, guillemet ou préfixe
3. Chaque ligne = phrase complète prête à envoyer
4. IMPORTANT: Si un timestamp comme [0:04] ou 0:13 est présent, tu DOIS le garder au DÉBUT de chaque reformulation
5. Format: [timestamp] + phrase professionnelle`
      },
      {
        role: 'user',
        content: `Reformule ce feedback vidéo en 3 versions professionnelles.${timestamp ? ` GARDE LE TIMESTAMP "${timestamp}" au début de chaque ligne.` : ''}\n\nTexte: ${text}`
      }
    ], { model: config.groq.models.fast, maxTokens: 300 });

    // Parse the result into an array of options
    let options = result
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('-') && !line.match(/^\d+[\.\)]/))
      .slice(0, 3);

    // Ensure timestamp is included in each option if it was in the original
    if (timestamp) {
      options = options.map(opt => {
        // Check if option already has the timestamp
        if (!opt.includes(timestamp.replace('[', '').replace(']', ''))) {
          return `${timestamp.startsWith('[') ? timestamp : `[${timestamp}]`} ${opt}`;
        }
        return opt;
      });
    }

    return options.length > 0 ? options : [text];
  } catch (error) {
    logger.error('Rephrase Error:', error);
    return [text];
  }
};
