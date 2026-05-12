# Infra — Google Cloud

## Vue d'ensemble du projet GCP

| Ressource | Nom | Région | Usage |
|---|---|---|---|
| Projet GCP | `toftal-clip-api` | — | Tout sauf le front |
| Service Cloud Run (staging) | `toftal-clip-api-staging` | `europe-west1` | API |
| Service Cloud Run (prod) | `toftal-clip-api` | `europe-west1` | API |
| Cloud Run Jobs | `faststart-worker-staging` etc. | `europe-west1` | Workers vidéo |
| Cloud SQL | `toftal-clip-db` | `europe-west1` | PostgreSQL |
| Cloud Storage | `toftal-clip-media` | multi-région EU | Vidéos |
| Cloud Build | — | global | CI/CD |
| Cloud CDN | backend bucket | global | Distribution médias |
| Secret Manager | divers | global | Secrets app |

## Création d'un nouvel environnement

!!! warning "Ce runbook part de zéro"
    Ne le suis que si tu crées un nouvel environnement (par exemple un futur
    environnement `preview` ou `dev` indépendant du staging actuel).

### 1. Activer les APIs nécessaires

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  --project=toftal-clip-api
```

### 2. Bucket GCS

```bash
gcloud storage buckets create gs://toftal-clip-media \
  --location=EU \
  --uniform-bucket-level-access \
  --project=toftal-clip-api

# Lecture publique pour les médias servis via CDN
gcloud storage buckets add-iam-policy-binding gs://toftal-clip-media \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

### 3. Cloud SQL

```bash
gcloud sql instances create toftal-clip-db \
  --database-version=POSTGRES_14 \
  --cpu=2 --memory=4GiB \
  --region=europe-west1 \
  --root-password='<secret>' \
  --project=toftal-clip-api

gcloud sql databases create toftal_clip --instance=toftal-clip-db
```

### 4. Service account pour Cloud Run

Le service account par défaut du compute (`<project-number>-compute@...`)
suffit, mais pour cloisonner les permissions on a un SA dédié :

| Rôle | Usage |
|---|---|
| `roles/cloudsql.client` | Se connecter à Cloud SQL |
| `roles/storage.objectAdmin` (sur le bucket) | Lire/écrire les vidéos |
| `roles/secretmanager.secretAccessor` | Lire les secrets |
| `roles/run.invoker` (sur les Jobs) | Trigger les workers depuis l'API |

### 5. Secrets

Tous les secrets vivent dans **Secret Manager**. Liste actuelle :

| Nom | Description |
|---|---|
| `DATABASE_URL` (prod) / `DATABASE_URL_STAGING` | Chaîne de connexion Postgres |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Signature des tokens |
| `EMAIL_PASSWORD` | SMTP transactionnel |
| `BICTORYS_PUBLIC_KEY*`, `BICTORYS_SECRET_KEY*`, `BICTORYS_WEBHOOK_SECRET*` | Bictorys (par env) |
| `GROQ_API_KEY` | LLM (transcription, suggestions) |
| `UPSTASH_REDIS_REST_TOKEN`, `REDIS_TCP_URL` | Redis Upstash |
| `INTERNAL_API_SECRET*` | Auth des appels worker → API |

!!! warning "Synchronisation `--set-secrets`"
    Le déploiement Cloud Run utilise `--set-secrets` qui **remplace** la liste
    complète des secrets attachés au service. Si tu attaches un secret
    manuellement via la console, il sera **wipé** au prochain deploy si tu
    ne l'ajoutes pas dans `cloudbuild*.yaml`.

### 6. Cloud CDN sur le bucket

Voir [Cloud CDN setup](#cloud-cdn) ci-dessous.

## Cloud CDN

Le bucket `toftal-clip-media` est exposé via un Load Balancer HTTPS avec un
**backend bucket** Cloud CDN. Avantages :

- Cache edge global → faible latence depuis l'Afrique
- HTTPS sur un domaine custom (`media.staging.toftalclip.io`)
- Compression Brotli automatique sur le HTML/JSON, gzip sur le reste

### Setup

```bash
# 1. Backend bucket
gcloud compute backend-buckets create toftal-clip-media-backend \
  --gcs-bucket-name=toftal-clip-media \
  --enable-cdn \
  --project=toftal-clip-api

# 2. URL map
gcloud compute url-maps create media-lb-url-map \
  --default-backend-bucket=toftal-clip-media-backend

# 3. Cert managé
gcloud compute ssl-certificates create media-cert \
  --domains=media.staging.toftalclip.io,media.toftalclip.io \
  --global

# 4. Target HTTPS proxy + forwarding rule
gcloud compute target-https-proxies create media-https-proxy \
  --url-map=media-lb-url-map --ssl-certificates=media-cert

gcloud compute forwarding-rules create media-https-fr \
  --target-https-proxy=media-https-proxy --ports=443 --global

# 5. DNS : pointer media.staging.toftalclip.io → IP du forwarding rule
```

### Invalidation cache

```bash
gcloud compute url-maps invalidate-cdn-cache media-lb-url-map \
  --path "/videos/<uuid>.mp4"
```
