# Infra — Observabilité

Trois canaux pour comprendre ce qui se passe en prod :

| Outil | Quoi | Couvre |
|---|---|---|
| **Cloud Logging** | Logs stdout/stderr de Cloud Run (API + workers) | Backend |
| **Sentry** | Erreurs, performance, session replay | Front |
| **Amplitude** | Events produit, funnels, retention | Front |

Chacun a un rôle distinct — pas de doublon. Une erreur backend va dans
Cloud Logging, une erreur frontend va dans Sentry, un click sur "Souscrire"
va dans Amplitude.

## Cloud Logging (backend)

Tous les `console.log/.warn/.error` du backend remontent automatiquement
dans Cloud Logging. Pas de lib supplémentaire (pas de Winston/Bunyan).

```bash
# Logs récents de l'API staging
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="toftal-clip-api-staging"' \
  --limit=50 --freshness=10m \
  --project=toftal-clip-api \
  --format="value(timestamp,textPayload)"

# Filtrer par niveau d'erreur
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="toftal-clip-api-staging"
   AND severity>=ERROR' \
  --limit=20 --freshness=1h
```

### Convention de logs

Préfixer par un emoji + un tag pour grepper :

| Tag | Domaine |
|---|---|
| `🎬 [TUS]` | TUS upload |
| `✅ [version]` | Worker faststart/preview/HLS |
| `❌ [bictorys]` | Bictorys |
| `📧 [email]` | EmailService |
| `🤖 [ai]` | AI service |
| `🔐 [auth]` | Auth |

Les emojis se grep dans Cloud Logging en URL-encoded ; en pratique on
filtre par tag texte (`textPayload:"[bictorys]"`).

## Sentry (frontend)

Lib : `@sentry/react`. Init dans `services/sentry.ts`, appelé depuis
`index.tsx` **avant** `createRoot`.

### Activation par environnement

| Env | Comportement |
|---|---|
| `local` (sans `VITE_SENTRY_ALLOW_DEV`) | No-op — pas de report |
| `local-test` (avec `VITE_SENTRY_ALLOW_DEV=true`) | Reporte au project Sentry |
| Netlify staging | Reporte tagged `environment: staging` |
| Netlify prod | Reporte tagged `environment: production` |

Variables d'env :

| Variable | Usage |
|---|---|
| `VITE_SENTRY_DSN` | DSN Sentry (public, OK dans le bundle) |
| `VITE_APP_ENV` | Tag `environment` |
| `VITE_SENTRY_ALLOW_DEV` | `true` pour activer en dev local |

### Réglages clés

- **Sample rates** ajustés pour rester dans le **free tier mensuel**
  (5k errors, 10k transactions, 50 replays).
- **Replay sample rate** : 10 % des sessions, **100 %** quand une erreur
  a été capturée → on ne paye pas pour les sessions sans incident.
- **`ignoreErrors`** filtre les bruits classiques (ResizeObserver loop,
  AbortError, xhr poll error de Socket.io, extensions browser, etc.).
- **`beforeSend`** sanitize les payloads (retire les tokens, les emails
  des breadcrumbs si configuré).

### Ce qu'on capture

- **Erreurs JS non-catchées** (incluant les rejections de Promise)
- **Performance** : navigation, fetch, paint metrics
- **Session replays** : enregistrement de la session DOM (anonymisée par
  défaut sur les inputs)

### Ce qu'on ne capture pas

- Les erreurs réseau attendues (`AbortError` quand l'user navigue
  pendant un fetch, 4xx attendus comme un 401 sur login refusé)
- Les rate-limited messages (Sentry agrège)
- Les erreurs backend (elles vivent côté Cloud Logging)

### Usage manuel

```typescript
import * as Sentry from '@sentry/react';

try {
  await riskyThing();
} catch (err) {
  Sentry.captureException(err, {
    tags: { feature: 'upload' },
    extra: { fileSize: file.size },
  });
  throw err; // re-throw pour le gestionnaire UI
}
```

## Amplitude (frontend)

Lib : `@amplitude/unified`. Service dans `services/amplitudeService.ts`.

### Activation

| Variable | Usage |
|---|---|
| `VITE_AMPLITUDE_API_KEY` | API key Amplitude (publique, dans le bundle) |

Si la key est vide → no-op.

### Architecture

`AnalyticsContext` (dans `context/AnalyticsContext.tsx`) wrappe l'app et :

- initialise Amplitude au boot
- attache l'identité user au login (`identify`)
- track les page views automatiquement via React Router

### Events normalisés

Tous les events sont **constantes** dans `services/amplitudeService.ts` →
`EVENTS.*` :

```typescript
import { trackEvent, EVENTS } from '../services/amplitudeService';

trackEvent(EVENTS.PROJECT_CREATED, {
  projectId: project.id,
  type: project.type,
});
```

Catégories couvertes (extrait) :

- **Auth** : `USER_REGISTERED`, `USER_LOGGED_IN`, `EMAIL_VERIFIED`
- **Projects** : `PROJECT_CREATED`, `PROJECT_VIEWED`, `PROJECT_ARCHIVED`
- **Deliverables** : `DELIVERABLE_CREATED`, `DELIVERABLE_COMPLETED`
- **Talent mode** : `TALENT_MODE_ENABLED`/`DISABLED`
- ... (voir `EVENTS` dans le service pour la liste exhaustive)

### Conventions

- **Pas d'event ad-hoc** : si l'event n'est pas dans `EVENTS`, l'ajouter
  d'abord. Évite la dérive des noms (`project_created` vs `projectCreated`
  vs `Project Created`).
- **Properties typées** : préférer un objet structuré à un booléen.
  ✅ `{ source: 'modal' | 'sidebar' }` ; ❌ `{ fromModal: true }`.
- **Pas de PII** : ne jamais passer un email, un nom, un IP en property.
  L'`userId` Amplitude est suffisant pour rejoindre les events à un user.

### Funnels en place

À documenter par la team produit. Les funnels critiques (à maintenir
s'ils cassent dans Amplitude) :

- Onboarding : `USER_REGISTERED` → `PROJECT_CREATED` → `DELIVERABLE_CREATED`
- Conversion paiement : `CHECKOUT_STARTED` → `CHECKOUT_COMPLETED`
- Activation talent : `TALENT_MODE_ENABLED` → `OPPORTUNITY_VIEWED` → `OPPORTUNITY_APPLIED`

## Quand utiliser quoi ?

| Situation | Outil |
|---|---|
| API renvoie 500 | Cloud Logging |
| Front crashe avec une stack JS | Sentry |
| User clique sur un bouton et rien ne se passe (pas d'erreur) | Amplitude (vérifier funnel) + Sentry (replay) |
| Worker faststart timeout | Cloud Logging (sur le job Cloud Run) |
| Mesurer le taux de complétion d'un onboarding | Amplitude |
| Comprendre une session user spécifique | Sentry replay |

## Coûts

| Outil | Plan actuel | À surveiller |
|---|---|---|
| Cloud Logging | Free 50 GB/mois | Trafic backend qui explose |
| Sentry | Free tier (5k errors, 10k tx, 50 replays /mois) | Pic d'erreurs après deploy |
| Amplitude | Plan Starter | Volume d'events |

Si l'un des trois explose son budget, vérifier d'abord le sample rate
ou les `ignoreErrors`/filtres avant de payer un upgrade.

## `IGNORE_ERRORS` Sentry — patterns accumulés

Au fil des sessions, certains messages d'erreur reviennent souvent
sans être actionnables. Pour rester dans le free tier (5k events /
mois) et éviter le bruit, on les filtre côté SDK avant envoi. Le
filtre est dans `services/sentry.ts` → `IGNORE_ERRORS`.

| Pattern | Source | Pourquoi on ignore |
|---|---|---|
| `ResizeObserver loop limit exceeded` | Browser quirk | Bug connu de ResizeObserver, n'a aucune conséquence applicative |
| `Non-Error promise rejection captured` | Promesse rejetée avec une valeur non-Error | Bruit, généralement aborts |
| `/^AbortError/` | Fetch annulé | L'user a navigué ailleurs avant la fin de la requête, expected |
| `/cancelled$/i` | idem | idem |
| `NetworkError when attempting to fetch resource.` | Firefox Fetch cancelled | idem |
| `/^Network Error$/` | axios cancelled | idem |
| `The operation couldn't be completed` | Safari media playback | iOS Safari quirk pendant lecture vidéo, pas notre code |
| `/xhr poll error/i` | Socket.io polling fallback | Reconnect Socket.io tournoie sur ces erreurs, finit par re-up tout seul |
| `/^websocket error$/i` | Socket.io | idem |
| `/transport close/i` | Socket.io | Le user a switché de réseau / fermé l'onglet |
| `/transport error/i` | Socket.io | Network blip transitoire |
| `Failed to fetch` | Browser fetch | Souvent un network blip ou nav |
| `/Connection to Indexed Database server lost/i` | iOS Safari memory pressure | Safari ferme IDB préemptivement quand RAM faible |
| `/database connection is closing/i` | idem | idem, side effect de la précédente |
| `/chrome-extension:\/\//` + `/moz-extension:\/\//` | Browser extensions | L'extension d'un user inject du JS qui crashe, c'est pas notre code |

### Patterns côté Amplitude

Amplitude Session Replay est **désactivé sur iOS** (`isIOS` check dans
`services/amplitudeService.ts`). Raison : sur iPhone, la sérialisation
DOM continue du replay consomme la RAM de Safari et provoque les
fermetures de WebSocket / IndexedDB qu'on filtre dans Sentry. On
laisse le tracking analytique (page views, events), juste pas le replay.

### Pour ajouter un pattern

1. Vérifier qu'il revient au moins ~10 fois / semaine dans Sentry
2. Confirmer qu'il n'est pas actionnable (= pas un vrai bug user-impactant)
3. L'ajouter à `IGNORE_ERRORS` dans `services/sentry.ts`
4. Commit + déployer le front
5. Surveiller que le rate Sentry baisse comme prévu

Une fois ignoré, le pattern n'apparaît **jamais** dans le dashboard
Sentry — on peut le ré-activer en supprimant la ligne et redéployant.
