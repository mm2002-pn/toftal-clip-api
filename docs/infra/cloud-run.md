# Infra — Cloud Run

## Service API

| Paramètre | Staging | Prod |
|---|---|---|
| Service | `toftal-clip-api-staging` | `toftal-clip-api` |
| Région | `europe-west1` | `europe-west1` |
| Image | `gcr.io/toftal-clip-api/api-staging:<sha>` | `.../api:<sha>` |
| Min instances | 2 | 2 |
| Max instances | 20 | 20 |
| Memory | 1 GiB | 1 GiB |
| CPU | 1 | 1 |
| Concurrency | 80 (default) | 80 |
| Timeout | 3600s | 3600s |
| Generation | gen2 | gen2 |
| Auth | unauthenticated (auth applicative côté Express) | idem |

!!! info "Pourquoi 2 min instances ?"
    Le retour de checkout Bictorys redirige le user après paiement. On a
    1-2 secondes pour répondre, un cold-start (~3s sur Cloud Run gen2) le
    fait timeout côté UX. Avec 2 instances chaudes, on est safe.

!!! warning "Pas de session affinity"
    Avec `@tus/gcs-store` les chunks d'upload vont **directement** sur GCS,
    aucune affinité d'instance n'est nécessaire. Le flag `--session-affinity`
    a été retiré des cloudbuild yamls — ne le remettez **pas**, il ne sert à
    rien et complique le routage.

## Cloud Run Jobs (workers)

| Job | Sizing | Timeout | Job env |
|---|---|---|---|
| `faststart-worker-{env}` | 16 Gi / 8 vCPU | 30 min | `VERSION_ID` (override) |
| `preview-worker-{env}` | 16 Gi / 8 vCPU | 15 min | `VERSION_ID` |
| `hls-worker-{env}` | 16 Gi / 8 vCPU | 30 min | `VERSION_ID` |

Tous en **gen2** (SSD scratch + RAM-backed `/tmp`).

### Déclencher un job manuellement

```bash
gcloud run jobs execute faststart-worker-staging \
  --update-env-vars=VERSION_ID=<uuid> \
  --region=europe-west1 \
  --project=toftal-clip-api
```

### Logs d'un job

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="faststart-worker-staging"' \
  --limit=50 --freshness=30m \
  --project=toftal-clip-api \
  --format="value(timestamp,textPayload)"
```

## Variables d'environnement Cloud Run

Voir `cloudbuild-staging.yaml` et `cloudbuild.yaml` — la liste fait foi.
Pour ajouter une nouvelle var d'env :

1. Si c'est un secret, le créer dans Secret Manager (`gcloud secrets create`)
2. L'ajouter à la chaîne `--set-secrets` du deploy step
3. L'ajouter au `Dockerfile` si nécessaire (pour les builds compile-time)
4. Push staging d'abord, valider, puis main

!!! danger "`--set-secrets` REMPLACE"
    Cette commande **remplace** la liste complète des secrets sur le service.
    Si tu oublies un secret existant dans la chaîne, il sera détaché.
    Vérifie que la chaîne contient TOUS les secrets actuels avant de push.
