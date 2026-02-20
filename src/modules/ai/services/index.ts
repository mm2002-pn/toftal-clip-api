import { config } from '../../../config';
import { chatCompletionJSON, chatCompletion, transcribeAudio as groqTranscribe } from '../../../config/groq';
import { logger } from '../../../utils/logger';
import { prisma } from '../../../config/database';

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
    const result = await chatCompletionJSON<BriefOptimization>([
      {
        role: 'system',
        content: `Tu es un directeur de création expert spécialisé dans le contenu vidéo pour les réseaux sociaux.
Tu dois analyser des briefs créatifs et générer des recommandations stratégiques en français.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Analyse ce brief et génère des recommandations:

Type de contenu: ${brief.contentType || 'Non spécifié'}
Objectif: ${brief.objective || 'Non spécifié'}
Audience cible: ${brief.targetAudience || 'Non spécifié'}
Ton souhaité: ${brief.tone || 'Non spécifié'}
Budget: ${brief.budget || 'Non spécifié'}

Retourne un JSON avec:
{
  "aiSummary": "Résumé stratégique en 1-2 phrases",
  "aiStructure": ["Phase 1", "Phase 2", "Phase 3"],
  "aiHook": "Une accroche percutante pour arrêter le scroll",
  "aiKeyPoints": ["Point 1", "Point 2", "Point 3"]
}`
      }
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

    const result = await chatCompletionJSON<{ matches: TalentMatch[] }>([
      {
        role: 'system',
        content: `Tu es un chasseur de têtes expert pour les créatifs vidéo.
Tu dois matcher les talents avec les projets en fonction de leurs compétences.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Brief du projet:
${JSON.stringify(brief, null, 2)}

Talents disponibles:
${JSON.stringify(talentList, null, 2)}

Sélectionne les 3 meilleurs talents et retourne:
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
    const result = await chatCompletionJSON<VideoAnalysis>([
      {
        role: 'system',
        content: `Tu es un expert en analyse de contenu vidéo pour les réseaux sociaux.
Tu évalues les vidéos selon leur potentiel d'engagement.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Analyse cette vidéo/concept:
"${description}"

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
    const result = await chatCompletionJSON<TaskGeneration>([
      {
        role: 'system',
        content: `Tu es un chef de projet vidéo.
Tu transformes les retours clients en tâches actionnables pour les monteurs.
Réponds UNIQUEMENT en JSON valide.`
      },
      {
        role: 'user',
        content: `Feedback client (peut être brut ou conversationnel):
"${feedbackText}"

Transforme en:
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
