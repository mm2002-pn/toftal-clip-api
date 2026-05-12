# Conventions — Style de code

## Backend

- **Strict mode TypeScript** activé (`"strict": true` dans `tsconfig.json`).
- Pas de `any` sauf pour interop avec une lib non typée. Préférer `unknown`
  + narrowing.
- `async/await` partout, pas de `.then().catch()` en chaîne.
- Erreurs métier : `throw { status_code: 4xx, body: '...' }` (capté par le
  middleware d'erreur Express).
- Logs : `console.log` / `console.warn` / `console.error` — Cloud Logging
  capture stdout/stderr automatiquement. Pas de winston/bunyan.
- Préfixer les logs par un emoji + un tag pour grepper dans Cloud Logging :
  `🎬 [TUS]`, `✅ [version]`, `❌ [bictorys]`, etc.

## Frontend

- **TypeScript strict** activé.
- Composants fonctionnels uniquement, pas de class components.
- `useCallback` / `useMemo` **seulement** quand nécessaire (référence stable
  pour un dep, calcul cher). Pas de "wrap everything by default".
- `useEffect` cleanup obligatoire pour les abonnements (socket, intervals).
- Tailwind classes : ordre logique (layout → spacing → couleur → typo →
  états). Plugin Prettier Tailwind si installé, sinon manuel.

## Erreurs

- **Toujours** capturer dans une frontière (controller backend, top-level
  promise frontend) — jamais d'erreur unhandled qui crash le service.
- **Jamais** afficher le `error.message` brut à l'utilisateur — sanitize
  d'abord. Les libs comme tus-js-client embedent l'URL et le body dans le
  message → leak d'archi (cf. ce qu'on a fait dans `mediaService.ts`).

## Tests

### Backend

- **Jest** (config `jest.config.js`) — tests unitaires des services purs.
- Lancer : `npm test`, en watch : `npm run test:watch`,
  couverture : `npm run test:coverage`.
- Couverture actuelle : **partielle** (surtout les services). Les
  controllers et resolvers GraphQL ne sont pas couverts par des tests
  intégration → smoke test manuel obligatoire au déploiement
  (cf. [deploy-staging](../runbooks/deploy-staging.md)).

### Frontend

Pas de framework de test installé pour l'instant. À ajouter :

- **Vitest** + React Testing Library pour les composants critiques
- **Playwright** pour les scénarios E2E (login, upload, share, checkout)

### Load testing

`load-test-k6.js` à la racine de l'API : scénarios k6 pour mesurer la
tenue en charge. Voir `LOAD-TEST-GUIDE.md` (à migrer dans cette doc).
