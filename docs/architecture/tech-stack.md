# Architecture — Stack technique

## Front-end (`toftal-clip`)

| Couche | Tech |
|---|---|
| Bundler | Vite |
| Framework | React 18 + TypeScript |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Player vidéo | `<video>` natif + hls.js |
| Upload résumable | `tus-js-client` |
| State global | React Context (Auth, Org, Upload, Toast) |
| Routing | React Router |
| HTTP | Axios |
| GraphQL client | (en cours d'évaluation — fetch direct vers `/graphql` aujourd'hui) |
| Real-time | Socket.io client |
| Push notifications | Firebase Cloud Messaging (FCM) |
| Observabilité | Sentry, Amplitude |
| Hébergement | Netlify |

## Back-end (`toftal-clip-api`)

### Framework & runtime

| Couche | Tech |
|---|---|
| Runtime | Node.js 20, TypeScript 5 |
| Framework HTTP | Express 5 |
| GraphQL | Apollo Server v4 + `@graphql-tools/{schema,merge}` |
| Real-time | Socket.io + `@socket.io/redis-adapter` |

### Données

| Couche | Tech |
|---|---|
| ORM | Prisma 5 |
| DB primaire | PostgreSQL 14 (Cloud SQL) |
| Cache / locks / queues légères | Redis (Upstash) |
| DataLoader | `dataloader` (batching N+1 GraphQL) |

### Médias

| Couche | Tech |
|---|---|
| Stockage | Google Cloud Storage |
| Upload résumable | `@tus/server` + `@tus/gcs-store` |
| Encoding | `fluent-ffmpeg` + binaire `ffmpeg`/`ffprobe` |
| CDN | Cloud CDN sur backend bucket |

### Workers

| Couche | Tech |
|---|---|
| Orchestration | Cloud Run Jobs gen2 |
| Trigger | `@google-cloud/run` SDK depuis l'API |

### Auth & sécurité

| Couche | Tech |
|---|---|
| Sessions | JWT access + refresh tokens (`jsonwebtoken`) |
| Hash mots de passe | `bcryptjs` |
| Cookies | `cookie-parser` (auth secondaire) |
| Validation | `express-validator` |
| Rate limiting | `express-rate-limit` |
| CORS | `cors` |
| Compression | `compression` (gzip réponses) |

### Intégrations externes

| Service | Usage |
|---|---|
| Bictorys | Paiements (mobile money + cartes) |
| Firebase Admin | Push FCM Android/iOS/Web |
| Groq | LLM (LLaMA 3.x) + transcription audio (Whisper) — voir [Flows › IA](../flows/ai.md) |
| Google Generative AI (Gemini) | Dans `package.json` mais non importé — vestige, à supprimer |
| Cloudinary | Thumbnails legacy (à phase out — remplacé par `VideoThumbnailService`) |
| Resend / SMTP | Emails transactionnels |

### Tests

| Couche | Tech |
|---|---|
| Test runner | Jest |
| Couverture | `jest --coverage` |

État actuel : couverture **partielle**, surtout sur les services purs.
Pas de E2E automatisé pour l'instant.

### Hébergement

- **Cloud Run** (service API)
- **Cloud Run Jobs** (workers vidéo)
- **Cloud Build** (CI/CD)
- **Secret Manager** (secrets)
- **Cloud SQL** (Postgres)
- **Cloud Storage** (médias)
- **Cloud Scheduler** (à venir, pour les backfills périodiques)

## Outillage commun

| Outil | Usage |
|---|---|
| `npm` | Gestion des dépendances |
| `tsc` | Type-check |
| `nodemon` | Hot-reload en dev (config dans `nodemon.json`) |
| `prisma migrate` | Migrations DB |
| `gcloud` | Déploiement, logs, secrets |
| `gsutil` / `gcloud storage` | Manipulation GCS |
| `mkdocs` | Cette doc |
| `k6` | Load testing (`load-test-k6.js`) |
