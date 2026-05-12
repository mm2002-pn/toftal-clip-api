# Runbook — Déploiement production

!!! danger "Avant de déployer en prod"
    1. Toutes les features de cette release ont été testées **en staging**
       (au moins 24 h d'usage utilisateur réel).
    2. Tu as fait un **dump de la base de prod** (cf. plus bas).
    3. Aucune migration DB destructive (DROP COLUMN) sans plan de rollback.
    4. Tu as un plan de rollback (revision Cloud Run précédente identifiée).

## Procédure

### 1. Synchroniser `main` avec `staging`

```bash
git checkout main
git pull --rebase
git merge staging --no-ff
git push origin main
```

Le push déclenche le pipeline `cloudbuild.yaml`.

### 2. Dumper la base avant migration

```bash
gcloud sql export sql toftal-clip-db \
  gs://toftal-clip-backups/prod-$(date +%Y%m%d-%H%M).sql.gz \
  --database=toftal_clip --project=toftal-clip-api
```

Vérifier la présence du dump dans GCS avant de continuer.

### 3. Suivre le build

```bash
gcloud builds list --project=toftal-clip-api --limit=2 \
  --format="table(id,status,createTime.date(tz=UTC),substitutions.SHORT_SHA)"
```

### 4. Migration DB

```bash
DATABASE_URL=$(gcloud secrets versions access latest \
  --secret=DATABASE_URL --project=toftal-clip-api) \
  npx prisma migrate deploy
```

### 5. Smoke test prod

- `curl -I https://toftalclip.io` (front)
- `curl -i https://api.toftalclip.io/health` (API)
- Login d'un compte de test sur la prod
- Vérifier qu'aucun **alert** ne trigger dans Cloud Monitoring (5 min)

### 6. Annoncer le déploiement

Slack #ops : "Deploy prod `<sha>`. Changelog : ..."

## Rollback

Si quelque chose casse en prod :

```bash
# Lister les revisions Cloud Run
gcloud run revisions list --service=toftal-clip-api \
  --region=europe-west1 --project=toftal-clip-api

# Router 100% du traffic sur la revision précédente
gcloud run services update-traffic toftal-clip-api \
  --to-revisions=<previous-revision-name>=100 \
  --region=europe-west1 --project=toftal-clip-api
```

Si la migration DB est en cause : restore le dump :

```bash
gcloud sql import sql toftal-clip-db \
  gs://toftal-clip-backups/prod-<YYYYMMDD-HHMM>.sql.gz \
  --database=toftal_clip --project=toftal-clip-api
```

⚠️ L'import efface la base et la remplace par le dump — les écritures faites
**après** le dump sont perdues. Calculer le coût avant de déclencher.
