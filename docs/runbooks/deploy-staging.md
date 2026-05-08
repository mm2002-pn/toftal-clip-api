# Runbook — Déploiement staging

## Pré-requis

- Tu as une PR fusionnée (ou des commits directs) sur la branche `staging`.
- Tu as `gcloud` configuré et authentifié.

## Procédure

### 1. Push sur `staging`

```bash
git checkout staging
git pull --rebase
# (tes commits sont déjà sur staging)
git push origin staging
```

Ça déclenche automatiquement le trigger Cloud Build configuré sur cette
branche (cf. [Cloud Build](../infra/cloud-build.md)).

### 2. Suivre le build

```bash
# Liste des derniers builds
gcloud builds list --project=toftal-clip-api --limit=3 \
  --format="table(id,status,createTime.date(tz=UTC),substitutions.SHORT_SHA)"

# Logs en stream du dernier build
LATEST=$(gcloud builds list --project=toftal-clip-api --limit=1 \
  --format="value(id)")
gcloud builds log $LATEST --project=toftal-clip-api --stream
```

Compte ~5-8 min pour un build complet (API + 3 workers).

### 3. Smoke test

```bash
# Healthcheck API
curl -i https://api.staging.toftalclip.io/health

# Front
curl -I https://staging.toftalclip.io
```

Puis ouvrir `https://staging.toftalclip.io` dans un browser propre (private),
faire un scénario clé :

- Login
- Créer un projet
- Upload une petite vidéo (<100 MB) → vérifier la lecture
- Upload une grosse vidéo (>200 MB) via TUS → vérifier la lecture du
  `_preview.mp4` après quelques secondes
- Tester le partage de lien
- Tester un checkout Bictorys (en mode sandbox)

### 4. En cas d'échec build

| Cause | Quoi faire |
|---|---|
| Erreur TypeScript | Reproduire en local : `npx tsc --noEmit`. Fix puis nouveau push. |
| Erreur Prisma migrate | Voir la section migrations ci-dessous. |
| OOM kill build | Augmenter le `_MEMORY` dans les substitutions du trigger. |
| Push image refusé | `gcloud auth configure-docker` puis re-push. |

### 5. Migrations DB

Les migrations Prisma sont **manuelles** sur staging (pas dans le pipeline,
pour éviter de pousser une migration cassée d'un coup) :

```bash
DATABASE_URL=$(gcloud secrets versions access latest \
  --secret=DATABASE_URL_STAGING --project=toftal-clip-api) \
  npx prisma migrate deploy
```

⚠️ Avant la migration, **dump** la base :

```bash
gcloud sql export sql toftal-clip-db \
  gs://toftal-clip-backups/staging-$(date +%Y%m%d-%H%M).sql.gz \
  --database=toftal_clip --project=toftal-clip-api
```

## Frontend

Le front Netlify se déploie tout seul sur push `staging` (auto-deploy). Pour
forcer un deploy depuis ta machine :

```bash
cd ../toftal-clip
npm run deploy:staging
```
