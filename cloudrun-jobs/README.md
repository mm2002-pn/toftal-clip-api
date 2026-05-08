# Cloud Run Jobs — Backfill

One-shot jobs to migrate legacy data on staging / production. The container
image is the **same** one built by `cloudbuild-staging.yaml` for the API
(no separate build step), so this folder just describes how the job runs.

## Prerequisites (one-time setup)

### 1. Service account
```bash
gcloud iam service-accounts create backfill-job-sa \
  --display-name="Toftal Backfill Job"

# Grant Cloud SQL client (so it can connect to the DB through the proxy)
gcloud projects add-iam-policy-binding toftal-clip-api \
  --member="serviceAccount:backfill-job-sa@toftal-clip-api.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Grant GCS object admin (so ffmpeg output can be uploaded)
gcloud projects add-iam-policy-binding toftal-clip-api \
  --member="serviceAccount:backfill-job-sa@toftal-clip-api.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Grant Secret Manager accessor (to read DATABASE_URL_STAGING)
gcloud projects add-iam-policy-binding toftal-clip-api \
  --member="serviceAccount:backfill-job-sa@toftal-clip-api.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2. Make sure the staging API has been deployed at least once
The job re-uses the image `gcr.io/toftal-clip-api/toftal-clip-api-staging:staging-latest`
which is tagged by `cloudbuild-staging.yaml`. So push the `staging` branch first.

### 3. Create the job
```bash
gcloud run jobs replace cloudrun-jobs/backfill-staging.yaml \
  --region=europe-west1
```

Re-run this command any time you change the YAML — it's idempotent.

## Running a backfill

Each `gcloud run jobs execute` creates one execution. You can trigger them
from the Cloud Console UI too (Cloud Run → Jobs → toftal-backfill-staging
→ Execute → add container-arg overrides).

```bash
# Metadata (duration, dimensions, fps)
gcloud run jobs execute toftal-backfill-staging \
  --region=europe-west1 \
  --args="run,backfill:metadata"

# Thumbnails (JPEG preview, 640px wide)
gcloud run jobs execute toftal-backfill-staging \
  --region=europe-west1 \
  --args="run,backfill:thumbnails"

# Cache-Control headers on GCS files
gcloud run jobs execute toftal-backfill-staging \
  --region=europe-west1 \
  --args="run,backfill:cache-control"

# Dry-run variants (preview without writing)
gcloud run jobs execute toftal-backfill-staging \
  --region=europe-west1 \
  --args="run,backfill:metadata:dry"
```

## Monitoring

```bash
# List recent executions
gcloud run jobs executions list \
  --job=toftal-backfill-staging --region=europe-west1

# Tail logs of the last execution
gcloud run jobs executions logs read <EXECUTION_ID> \
  --region=europe-west1
```

Or in the console: Cloud Run → Jobs → `toftal-backfill-staging` → pick an
execution → Logs tab.

## Safety

All three backfill scripts are **idempotent** — re-running them only processes
rows that still lack the corresponding data, so accidental duplicate executions
are safe.

## Production

When ready, duplicate `backfill-staging.yaml` as `backfill-prod.yaml`, swap
the image tag to `:latest` (or whatever production uses), point the secret
at `DATABASE_URL` (prod), and deploy the same way.
