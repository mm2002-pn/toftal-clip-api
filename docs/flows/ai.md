# Flows — Intelligence artificielle (Groq)

L'IA est utilisée à plusieurs endroits du produit. Le provider unique
aujourd'hui est **Groq** (compatible API OpenAI), qui sert à la fois pour
les chat completions (LLaMA 3.x) et la transcription audio (Whisper).

!!! info "Gemini"
    `@google/generative-ai` est dans `package.json` mais aucun import n'est
    actif dans `src/`. C'est un reste d'évaluation, à supprimer dans une
    passe de cleanup ou à activer si on veut un fallback / un autre modèle.

## Modèles utilisés

Source : `src/config/index.ts` :

| Alias | Modèle Groq | Usage |
|---|---|---|
| `powerful` | `llama-3.3-70b-versatile` | Tâches de raisonnement complexes (reformulation brief, analyse vidéo, matching) |
| `fast` | `llama-3.1-8b-instant` | Tâches simples / temps réel |
| `whisper` | `whisper-large-v3-turbo` | Transcription audio |

Endpoint : `https://api.groq.com/openai/v1` — protocole compatible OpenAI,
on utilise `fetch()` directement (pas de SDK).

## Module `ai`

```
src/modules/ai/
├── controllers/
├── routes/
├── services/
│   └── index.ts        # 6 fonctions métier
└── validators/
```

Helpers bas niveau dans `src/config/groq.ts` :

- `chatCompletion(messages, options)` — réponse string libre
- `chatCompletionJSON<T>(messages, options)` — réponse JSON typée
  (avec `response_format: { type: 'json_object' }`)
- `transcribeAudio(buffer, mimeType)` — Whisper

## 6 features IA actives

### 1. Reformulation / optimisation de brief

`optimizeBrief(brief)` — reformule le brief créatif d'un livrable pour
le rendre plus pro et actionnable. Si le brief existe déjà : reformule.
Sinon : génère depuis le titre + contexte.

Sortie : `{ aiSummary, keyPoints, suggestedDeliverables, ... }` typé.

### 2. Matching talents ↔ opportunité

`matchTalents(brief)` — étant donné un brief de mission, propose une
liste de talents pertinents avec un score et une raison. Lit la base
talents et passe les profils dans le prompt (via DataLoader pour
limiter les tokens).

### 3. Analyse vidéo

`analyzeVideo(description)` — à partir d'une description ou d'une
transcription, en extrait les thèmes, le mood, les suggestions
d'amélioration.

### 4. Génération de tâches

`generateTasks(feedbackText)` — convertit un retour client en liste
de tâches actionables (titre, description, priorité).

### 5. Reformulation de commentaires

`rephraseContent(text)` — propose **3 reformulations** professionnelles
d'un commentaire de feedback. Contraintes :

- 3 reformulations exactement, une par ligne
- Garde le timestamp s'il existe (`[0:04]` ou `0:13` au début)
- Ton pro mais conserve l'intention

C'est l'un des features les plus utilisés — il aide les clients à
formuler des retours constructifs sans devoir reformuler eux-mêmes.

### 6. Transcription audio (voice notes)

`transcribeAudio(audioBase64, mimeType)` — Whisper Large V3 turbo via
Groq. Latence ~1-3 s pour un message de 30 s. Utilisé sur les voice
notes laissées en commentaire (mobile surtout).

## Prompts en base de données

Les prompts ne sont **pas codés en dur** dans les services (ou alors
seulement comme fallback). Ils vivent dans la table `AiPrompt` :

| Colonne | Usage |
|---|---|
| `name` | Identifiant unique (ex. `optimize-brief`, `match-talents`) |
| `messages` | Array `{ role, content }` à envoyer à Groq |
| `model` | `powerful` ou `fast` |
| `temperature` | 0..1 |
| `version` | Pour A/B testing ou rollback |
| `enabled` | Désactive le prompt sans deploy |

Pattern d'utilisation :

```typescript
const dbPrompt = await prisma.aiPrompt.findUnique({ where: { name: 'optimize-brief' } });
if (dbPrompt?.enabled) {
  return await chatCompletionJSON<BriefOptimization>(dbPrompt.messages, {
    model: dbPrompt.model,
    temperature: dbPrompt.temperature,
  });
}
// fallback hardcodé
```

Le seeder `npm run seed:ai-prompts` (cf. [Scripts](../backend/scripts.md))
synchronise les prompts depuis `scripts/seed-ai-prompts.ts`. Pour
modifier un prompt en prod sans déploiement : update le row dans la
table directement (Prisma Studio via Cloud SQL Proxy).

!!! tip "Pourquoi en DB et pas en code ?"
    Les prompts sont la **partie qui change le plus souvent**. Les mettre
    en DB permet de :
    
    - Itérer rapidement sans redeploy (juste un update row)
    - Comparer plusieurs versions d'un prompt en parallèle
    - Désactiver d'urgence un prompt qui hallucine
    - Faire participer une PM qui ne touche pas le code

## Coûts

Groq facture au token. Ordres de grandeur observés :

| Feature | Tokens in | Tokens out | Coût approx |
|---|---|---|---|
| `optimizeBrief` | ~500 | ~300 | $0.0001 |
| `matchTalents` (10 talents) | ~3000 | ~600 | $0.0006 |
| `analyzeVideo` | ~1500 | ~400 | $0.0003 |
| `rephraseContent` | ~150 | ~250 | $0.0001 |
| `transcribeAudio` (30s) | — | — | $0.0003 / minute |

Volume actuel : largement en deçà du budget. À surveiller si la base
de talents grossit (le matching scale linéairement en talents).

## Variables d'env

| Variable | Usage |
|---|---|
| `GROQ_API_KEY` | Auth API Groq (Bearer header) |

## Pièges

!!! warning "Erreurs de parsing JSON"
    Même avec `response_format: json_object`, Groq peut ponctuellement
    renvoyer du JSON malformé. `chatCompletionJSON` retry une fois avec
    un message system rappelant le format. Si ça échoue encore → fallback
    hardcodé ou erreur métier explicite (jamais un crash silencieux).

!!! warning "Rate limits"
    Groq a des rate limits assez stricts sur le plan gratuit (~30 req/min).
    Pas un souci aujourd'hui mais à surveiller — implémenter un cache
    Redis si une feature devient massive.

!!! warning "Hallucinations sur les noms propres"
    Le matching talents peut inventer des noms si on ne lui fournit pas
    explicitement la liste. Toujours passer le catalogue dans le prompt
    et exiger que les `talentId` soient extraits de cette liste.
