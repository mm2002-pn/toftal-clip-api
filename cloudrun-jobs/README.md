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

Both `downscale-worker[-staging]` and `downscale-sweeper[-staging]` are
deployed automatically by `cloudbuild.yaml` / `cloudbuild-staging.yaml`
alongside faststart/hls/preview — no separate YAML to keep in sync.

### One-time IAM setup (per environment)

These commands must be run ONCE per environment. They are NOT in
`cloudbuild*.yaml` on purpose — we don't want the build pipeline to
have permission-grant powers in the project. Re-running is safe
(idempotent), so it's fine to leave them in shell history.

#### Staging — already done ✅

```bash
# API → invoker on the worker
gcloud run jobs add-iam-policy-binding downscale-worker-staging \
  --region=europe-west1 \
  --member='serviceAccount:776016345965-compute@developer.gserviceaccount.com' \
  --role='roles/run.invoker'

# Scheduler SA (re-used in prod too)
gcloud iam service-accounts create scheduler-invoker-sa \
  --display-name="Cloud Scheduler -> Cloud Run Jobs invoker"

# Scheduler → invoker on the sweeper
gcloud run jobs add-iam-policy-binding downscale-sweeper-staging \
  --region=europe-west1 \
  --member='serviceAccount:scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/run.invoker'

# Cron (every 5 min) — URI built in pieces because Cloud Shell wraps long lines
P1=https://europe-west1-run.googleapis.com
P2=/apis/run.googleapis.com/v1/namespaces/toftal-clip-api
P3=/jobs/downscale-sweeper-staging:run
URI="$P1$P2$P3"
gcloud scheduler jobs create http downscale-sweeper-staging-cron --location=europe-west1 --schedule='*/5 * * * *' --uri="$URI" --http-method=POST --oauth-service-account-email='scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com'
```

#### Production — to run ONCE after the first push to `main`

These 4 commands wire prod the same way as staging. The
`scheduler-invoker-sa` from staging is re-used, so no SA creation
needed.

```bash
# 1. API → invoker on the prod worker
gcloud run jobs add-iam-policy-binding downscale-worker \
  --region=europe-west1 \
  --member='serviceAccount:776016345965-compute@developer.gserviceaccount.com' \
  --role='roles/run.invoker'

# 2. Scheduler → invoker on the prod sweeper
gcloud run jobs add-iam-policy-binding downscale-sweeper \
  --region=europe-west1 \
  --member='serviceAccount:scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com' \
  --role='roles/run.invoker'

# 3. Build the prod URI in pieces
P1=https://europe-west1-run.googleapis.com
P2=/apis/run.googleapis.com/v1/namespaces/toftal-clip-api
P3=/jobs/downscale-sweeper:run
URI="$P1$P2$P3"

# 4. Create the prod cron (every 5 min)
gcloud scheduler jobs create http downscale-sweeper-cron --location=europe-west1 --schedule='*/5 * * * *' --uri="$URI" --http-method=POST --oauth-service-account-email='scheduler-invoker-sa@toftal-clip-api.iam.gserviceaccount.com'
```

Note: if the API service in prod uses a non-default runtime SA, replace
`776016345965-compute@developer.gserviceaccount.com` in step 1 with the
output of:

```bash
gcloud run services describe toftal-clip-api --region=europe-west1 \
  --format='value(spec.template.spec.serviceAccountName)'
```

### Smoke test (rare — usually you exercise via the API)

```bash
gcloud run jobs execute downscale-worker-staging \
  --region=europe-west1 \
  --update-env-vars=VERSION_ID=<uuid>,QUALITY=720p,JOB_ROW_ID=<uuid>
```

The worker writes `version_downscale_jobs.status = DONE` and mirrors the
URL into `versions.alternative_qualities` in a single transaction.
