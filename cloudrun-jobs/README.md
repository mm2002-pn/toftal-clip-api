# Cloud Run Jobs — Backfill + Downscale

One-shot jobs that share the API image (`cloudbuild-staging.yaml` builds
it). Three categories live here:

- **backfill-***   one-shot data migrations
- **toftal-downscale-staging**   per-request video downscale worker,
  triggered programmatically by the API (no manual `gcloud execute`).
- **toftal-downscale-sweeper-staging**   recycles stuck PROCESSING rows
  every 5 min via Cloud Scheduler.

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

## Downscale workers

The downscale Job is *triggered programmatically* from the API
(`downscaleJobsService.enqueueDownscale`) every time a user clicks
Download on a quality that isn't cached yet. You DON'T `gcloud execute`
it by hand — that's only useful for a smoke test.

### One-time setup

```bash
# Deploy the worker spec
gcloud run jobs replace cloudrun-jobs/downscale-staging.yaml \
  --region=europe-west1

# Deploy the sweeper spec
gcloud run jobs replace cloudrun-jobs/sweep-downscale-staging.yaml \
  --region=europe-west1

# Let the API SA invoke the worker. Replace <api-sa> with the staging
# API's Cloud Run runtime SA (usually `toftal-clip-api-staging@…`).
gcloud run jobs add-iam-policy-binding toftal-downscale-staging \
  --region=europe-west1 \
  --member='serviceAccount:<api-sa>@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/run.invoker'

# Cloud Scheduler trigger for the sweeper (every 5 min)
gcloud iam service-accounts create scheduler-invoker-sa \
  --display-name="Cloud Scheduler → Cloud Run Jobs invoker"

gcloud run jobs add-iam-policy-binding toftal-downscale-sweeper-staging \
  --region=europe-west1 \
  --member='serviceAccount:scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/run.invoker'

gcloud scheduler jobs create http downscale-sweeper-staging \
  --location=europe-west1 \
  --schedule='*/5 * * * *' \
  --uri='https://europe-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/toftal-clip-api/jobs/toftal-downscale-sweeper-staging:run' \
  --http-method=POST \
  --oauth-service-account-email='scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com'
```

### Smoke test (rare — usually you exercise via the API)

```bash
gcloud run jobs execute toftal-downscale-staging \
  --region=europe-west1 \
  --update-env-vars=VERSION_ID=<uuid>,QUALITY=720p,JOB_ROW_ID=<uuid>
```

The worker writes `version_downscale_jobs.status = DONE` and mirrors the
URL into `versions.alternative_qualities` in a single transaction.
