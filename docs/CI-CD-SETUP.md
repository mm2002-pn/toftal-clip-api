# CI/CD Setup Guide - Toftal Clip

## Overview

This guide explains how to set up one-click deployment for Toftal Clip.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   GitHub Actions                                                │
│        │                                                        │
│        ├── Push to main ──────► Production Deploy               │
│        │                                                        │
│        ├── Push to staging ───► Staging Deploy                  │
│        │                                                        │
│        └── Manual Trigger ────► Deploy All (One Click)          │
│                                                                 │
│   ┌─────────────┐         ┌─────────────┐                      │
│   │  Backend    │         │  Frontend   │                      │
│   │  Cloud Run  │         │  Netlify    │                      │
│   │  (GCP)      │         │  (CDN)      │                      │
│   └─────────────┘         └─────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Configure Google Cloud (Backend)

### Option A: Workload Identity Federation (Recommended - No Keys!)

1. **Create a Workload Identity Pool:**

```bash
# Set variables
export PROJECT_ID="toftal-clip-api"
export GITHUB_REPO="your-username/toftal-clip-api"

# Enable APIs
gcloud services enable iamcredentials.googleapis.com --project $PROJECT_ID

# Create Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
  --project=$PROJECT_ID \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create Provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project=$PROJECT_ID \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

2. **Create a Service Account:**

```bash
# Create service account
gcloud iam service-accounts create "github-actions" \
  --project=$PROJECT_ID \
  --display-name="GitHub Actions"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

3. **Link Service Account to Workload Identity:**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/$GITHUB_REPO"
```

4. **Get the Provider ID:**

```bash
gcloud iam workload-identity-pools providers describe "github-provider" \
  --project=$PROJECT_ID \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --format="value(name)"
```

### Option B: Service Account Key (Alternative)

```bash
# Create and download key
gcloud iam service-accounts keys create key.json \
  --iam-account=github-actions@$PROJECT_ID.iam.gserviceaccount.com

# Copy the content of key.json - you'll need it for GitHub Secrets
cat key.json | base64
```

## Step 2: Configure Netlify (Frontend)

1. Go to [Netlify User Settings](https://app.netlify.com/user/applications#personal-access-tokens)
2. Create a new **Personal Access Token**
3. Copy the token

4. Get your **Site ID**:
   - Go to your Netlify site
   - Site Settings → General → Site ID

## Step 3: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

### Backend Secrets (toftal-clip-api)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `WIF_PROVIDER` | Workload Identity Provider | `projects/123456/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `WIF_SERVICE_ACCOUNT` | Service Account email | `github-actions@toftal-clip-api.iam.gserviceaccount.com` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@/db?host=/cloudsql/project:region:instance` |
| `GCP_SA_KEY` | (Option B) Base64 encoded key | `ewogICJ0eXBlIjog...` |

### Frontend Secrets (toftal-clip)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `NETLIFY_AUTH_TOKEN` | Netlify Personal Access Token | `nfp_xxxxx` |
| `NETLIFY_SITE_ID` | Production site ID | `12345-abcd-6789` |
| `NETLIFY_SITE_ID_STAGING` | Staging site ID | `67890-efgh-1234` |
| `AMPLITUDE_API_KEY` | Analytics API key | `d236d9a0d92...` |

## Step 4: Deploy!

### Automatic Deployment (on push)

Simply push to `main` or `staging`:

```bash
# Deploy to production
git push origin main

# Deploy to staging
git push origin staging
```

### One-Click Deployment (Manual)

1. Go to GitHub → Actions → "Deploy All (One Click)"
2. Click "Run workflow"
3. Select options:
   - Environment: `production` or `staging`
   - Run migrations: `true` or `false`
   - Deploy backend: `true`
   - Deploy frontend: `true`
4. Click "Run workflow"

![One Click Deploy](https://docs.github.com/assets/cb-34335/images/help/actions/workflow-dispatch.png)

## Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Auto-deploy on push (backend) |
| `.github/workflows/deploy-all.yml` | One-click deploy everything |
| `toftal-clip/.github/workflows/deploy.yml` | Auto-deploy on push (frontend) |

## Troubleshooting

### Build fails on Cloud Run

```bash
# Check logs
gcloud logging read "resource.type=cloud_run_revision" --limit=50

# Check service status
gcloud run services describe toftal-clip-api --region europe-west1
```

### Netlify deployment fails

- Verify `NETLIFY_AUTH_TOKEN` is valid
- Check site ID matches your Netlify project
- Review build logs in Netlify dashboard

### Database migration fails

- Ensure Cloud SQL Proxy can connect
- Verify `DATABASE_URL` secret is correct
- Check Cloud SQL Admin API is enabled

## Local Testing

You can test the workflow locally with [act](https://github.com/nektos/act):

```bash
# Install act
brew install act  # or choco install act-cli

# Test workflow
act workflow_dispatch -W .github/workflows/deploy-all.yml
```

## Security Notes

1. **Never commit secrets** to the repository
2. **Use Workload Identity Federation** instead of service account keys when possible
3. **Rotate tokens** periodically
4. **Limit permissions** to minimum required
