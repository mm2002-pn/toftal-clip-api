# Runbook — Rollback

## Cloud Run service

### 1. Identifier la révision saine

```bash
gcloud run revisions list \
  --service=toftal-clip-api \
  --region=europe-west1 \
  --project=toftal-clip-api \
  --format="table(name,active,createTime,creator)"
```

La revision active a `active: yes`. Cherche la revision **précédente** qui a
fonctionné et copie son nom (ex. `toftal-clip-api-00042-abc`).

### 2. Router le traffic

```bash
gcloud run services update-traffic toftal-clip-api \
  --to-revisions=toftal-clip-api-00042-abc=100 \
  --region=europe-west1 \
  --project=toftal-clip-api
```

Effet : ~30 secondes le temps que le LB propage. La nouvelle revision casse
n'est pas supprimée — tu peux y revenir.

### 3. Vérifier

```bash
curl -i https://api.toftalclip.io/health
gcloud run services describe toftal-clip-api --region=europe-west1 \
  --format="value(status.traffic)"
```

## Cloud Run Jobs

Les jobs n'ont pas de notion de "revision active" comme les services — chaque
exécution utilise la dernière definition. Pour rollback :

```bash
gcloud run jobs deploy faststart-worker \
  --image=gcr.io/toftal-clip-api/api:<previous-sha> \
  --region=europe-west1 \
  --project=toftal-clip-api \
  # ... mêmes flags que dans cloudbuild.yaml
```

## Frontend Netlify

Console Netlify → Deploys → cliquer sur la deploy précédente → "Publish deploy".

Effet immédiat (CDN edge propagation ~30s).

## DB

Voir [deploy-prod](./deploy-prod.md#rollback) — restore depuis dump GCS.
