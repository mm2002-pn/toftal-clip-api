# Conventions — Naming

## Backend (TypeScript)

- **Fichiers** : kebab-case ou camelCase, suivre l'existant. Ex. `tus-upload/`,
  `mediaService.ts`, `bictorysService.ts`.
- **Classes** : PascalCase (`Server`, `GCSStore`).
- **Fonctions, variables** : camelCase (`getUploadProgress`, `bucketName`).
- **Types / interfaces** : PascalCase (`UploadResult`, `CreateChargeInput`).
- **Constantes module-level** : SCREAMING_SNAKE_CASE seulement pour les vrais
  constants (ex. `TUS_THRESHOLD = 100 * 1024 * 1024`). Sinon camelCase.

## Frontend (TypeScript + React)

- **Components** : PascalCase, fichier `.tsx` du même nom (`UploadWidget.tsx`).
- **Hooks** : `useXxx` toujours camelCase (`useProjectAccess`).
- **Pages** : PascalCase aussi.
- **Services / utils** : camelCase (`mediaService.ts`, `formatDate.ts`).

## Endpoints API

- Plurals pour les collections : `/projects`, `/deliverables`
- Verbes HTTP standards (GET liste, POST créer, PATCH update, DELETE supprimer)
- Sous-ressources : `/projects/:id/members`
- Pas de verbes dans les URLs (`/projects/:id/transfer-ownership` est une
  exception parce que c'est un workflow non-CRUD)

## Tables / colonnes Prisma

- **Tables** : PascalCase singulier (`User`, `Project`, `Version`)
- **Colonnes** : camelCase (`createdAt`, `videoUrl`)
- **FK** : `<entity>Id` (`projectId`, `userId`, `uploadedById`)
- **Enums** : SCREAMING_SNAKE_CASE pour les valeurs (`PROCESSING`, `READY`,
  `FAILED`)

## Buckets / paths GCS

- Bucket : `toftal-clip-media` (pas de variantes par env, on cloisonne par path
  ou par projet GCP)
- Vidéos source : `videos/<uuid>.<ext>`
- Vidéos retravaillées : `videos/<uuid>_faststart.mp4`, `_preview.mp4`
- HLS : `hls/<versionId>/master.m3u8` + segments
- Thumbnails : `thumbnails/<uuid>.jpg`

## Cloud Run services / jobs

- Service API : `toftal-clip-api-staging`, `toftal-clip-api`
- Jobs : `<worker>-worker-staging`, `<worker>-worker` (prod)
- Suffix `-staging` toujours, prod sans suffix
