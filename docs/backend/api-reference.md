# Backend — Référence API

!!! info "Auto-génération"
    À terme, cette page peut être générée à partir de specs OpenAPI ou
    d'annotations dans le code (via `swagger-jsdoc` ou similaire). Pour
    l'instant elle est rédigée à la main et donne une vue d'ensemble.

## Conventions

- Toutes les routes sont préfixées par `/api/v1/`
- Auth : header `Authorization: Bearer <accessToken>` (sauf endpoints publics)
- Response shape :
  ```json
  { "success": true, "data": { ... } }
  ```
  ou en cas d'erreur :
  ```json
  { "success": false, "error": "Message lisible" }
  ```

## Endpoints principaux

### Auth
- `POST /auth/register` — création de compte
- `POST /auth/login` — login
- `POST /auth/refresh` — rotation tokens
- `POST /auth/logout` — invalidation
- `GET /auth/me` — profil du user courant

### Projects
- `GET /projects` — liste des projets accessibles
- `POST /projects` — création
- `GET /projects/:id` — détail
- `PATCH /projects/:id` — update
- `DELETE /projects/:id`
- `POST /projects/:id/members` — ajouter un membre
- `DELETE /projects/:id/members/:memberId` — retirer
- `PATCH /projects/:id/members/:memberId` — changer rôle/permissions
- `POST /projects/:id/transfer-ownership` — demande de transfert

### Deliverables
- `GET /deliverables/:id` — détail (auth ou guest token)
- `POST /projects/:id/deliverables` — créer
- `POST /deliverables/:id/versions` — créer une version (post-upload)
- `GET /deliverables/:id/versions` — liste des versions

### TUS uploads
- `POST /tus` — créer un upload (TUS protocol)
- `HEAD /tus/:id` — offset
- `PATCH /tus/:id` — chunk
- `DELETE /tus/:id` — annuler
- `GET /tus/progress/:id` — progression (custom)
- `GET /tus/config` — config exposée au client

### Sharing
- `POST /projects/:id/share-links` — créer lien public projet
- `POST /deliverables/:id/share-links` — créer lien public vidéo
- `DELETE /share-links/:id` — désactiver

### Subscriptions
- `POST /subscriptions/checkout-session` — démarrer un checkout
- `GET /subscriptions/checkout-status/:chargeId` — statut
- `POST /subscriptions/webhook` — endpoint webhook Bictorys

### Internal (worker → API)
- `POST /internal/version-ready` — faststart fini
- `POST /internal/preview-ready` — preview MP4 prêt
- `POST /internal/hls-ready` — HLS prêt

Tous les `/internal/*` exigent `X-Internal-Secret`.

### Comments
- `GET /versions/:id/comments`
- `POST /versions/:id/comments`
- `DELETE /comments/:id`
- `POST /comments/:id/replies`

### Media
- `POST /media/gcs/signed-url` — signed URL pour upload direct GCS
- `POST /media/upload/video` — upload backend (< 30 MB)
- `POST /media/upload/audio` — voice notes

## WebSocket

Connexion : `wss://api.{env}.toftalclip.io/socket.io` avec auth
`auth: { token: '<accessToken>' }` à l'upgrade.

Events principaux :

| Event | Payload | Direction |
|---|---|---|
| `version:ready` | `{ versionId, type: 'faststart' \| 'preview' \| 'hls' }` | server → client |
| `comment:new` | `{ comment }` | server → client |
| `notification:new` | `{ notification }` | server → client |
| `project:member:added` | `{ projectId, member }` | server → client |
