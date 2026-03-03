# Deployment Guide - Google Cloud Run + Cloud SQL

This guide explains how to deploy Toftal Clip API to Google Cloud Run with Cloud SQL PostgreSQL.

## Prerequisites

1. **Google Cloud Account** with billing enabled
2. **gcloud CLI** installed: https://cloud.google.com/sdk/docs/install
3. **Docker** installed (for local testing)

## Quick Deploy (Automated)

### Windows (PowerShell)
```powershell
# Edit deploy.ps1 and set your PROJECT_ID
.\deploy.ps1
```

### Linux/Mac (Bash)
```bash
# Edit deploy.sh and set your PROJECT_ID
chmod +x deploy.sh
./deploy.sh
```

---

## Manual Deployment Steps

### Step 1: Setup GCP Project

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
export REGION="europe-west1"

# Login to GCP
gcloud auth login

# Set project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    containerregistry.googleapis.com
```

### Step 2: Create Cloud SQL Instance

```bash
# Create PostgreSQL instance (takes 5-10 minutes)
gcloud sql instances create toftal-clip-db \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=$REGION \
    --storage-type=SSD \
    --storage-size=10GB

# Create database
gcloud sql databases create toftal_clip \
    --instance=toftal-clip-db

# Create user (save the password!)
gcloud sql users create toftal_user \
    --instance=toftal-clip-db \
    --password=YOUR_SECURE_PASSWORD

# Get connection name
gcloud sql instances describe toftal-clip-db \
    --format='value(connectionName)'
# Output: project-id:region:toftal-clip-db
```

### Step 3: Create Secrets

```bash
# Database URL (replace values)
echo -n "postgresql://toftal_user:PASSWORD@localhost/toftal_clip?host=/cloudsql/PROJECT:REGION:toftal-clip-db" | \
    gcloud secrets create DATABASE_URL --data-file=-

# JWT Secrets
openssl rand -base64 48 | gcloud secrets create JWT_SECRET --data-file=-
openssl rand -base64 48 | gcloud secrets create JWT_REFRESH_SECRET --data-file=-

# Optional: Cloudinary
echo -n "your-cloud-name" | gcloud secrets create CLOUDINARY_CLOUD_NAME --data-file=-
echo -n "your-api-key" | gcloud secrets create CLOUDINARY_API_KEY --data-file=-
echo -n "your-api-secret" | gcloud secrets create CLOUDINARY_API_SECRET --data-file=-

# Optional: Gemini AI
echo -n "your-gemini-key" | gcloud secrets create GEMINI_API_KEY --data-file=-
```

### Step 4: Grant Secret Access

```bash
# Get service account
SERVICE_ACCOUNT=$(gcloud iam service-accounts list \
    --filter='displayName:Compute Engine default service account' \
    --format='value(email)')

# Grant access to secrets
for SECRET in DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET; do
    gcloud secrets add-iam-policy-binding $SECRET \
        --member="serviceAccount:$SERVICE_ACCOUNT" \
        --role="roles/secretmanager.secretAccessor"
done
```

### Step 5: Build and Deploy

```bash
# Build Docker image using Cloud Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/toftal-clip-api

# Deploy to Cloud Run
gcloud run deploy toftal-clip-api \
    --image gcr.io/$PROJECT_ID/toftal-clip-api \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --add-cloudsql-instances $PROJECT_ID:$REGION:toftal-clip-db \
    --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest" \
    --set-env-vars="NODE_ENV=production,API_VERSION=v1,JWT_EXPIRES_IN=15m,JWT_REFRESH_EXPIRES_IN=7d,CORS_ORIGIN=https://your-frontend.com" \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10
```

### Step 6: Run Database Migrations

```bash
# Install Cloud SQL Proxy
# Download from: https://cloud.google.com/sql/docs/postgres/sql-proxy

# Start proxy (in a separate terminal)
cloud_sql_proxy -instances=$PROJECT_ID:$REGION:toftal-clip-db=tcp:5432

# Run migrations
export DATABASE_URL="postgresql://toftal_user:PASSWORD@localhost:5432/toftal_clip"
npx prisma migrate deploy

# Seed database (optional)
npx prisma db seed
```

---

## Cloud SQL Instance Tiers

| Tier | vCPUs | Memory | Price/month |
|------|-------|--------|-------------|
| db-f1-micro | Shared | 0.6 GB | ~$8 |
| db-g1-small | Shared | 1.7 GB | ~$27 |
| db-custom-1-3840 | 1 | 3.75 GB | ~$50 |
| db-custom-2-7680 | 2 | 7.5 GB | ~$100 |

For production, use at least `db-g1-small`.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token secret |
| `NODE_ENV` | Yes | `production` |
| `PORT` | No | Default: 8080 |
| `API_VERSION` | No | Default: v1 |
| `JWT_EXPIRES_IN` | No | Default: 15m |
| `JWT_REFRESH_EXPIRES_IN` | No | Default: 7d |
| `CORS_ORIGIN` | Yes | Frontend URL |
| `CLOUDINARY_*` | No | For media uploads |
| `GEMINI_API_KEY` | No | For AI features |

---

## Useful Commands

```bash
# View logs
gcloud run services logs read toftal-clip-api --region $REGION

# View service details
gcloud run services describe toftal-clip-api --region $REGION

# Update environment variables
gcloud run services update toftal-clip-api \
    --region $REGION \
    --set-env-vars="CORS_ORIGIN=https://new-frontend.com"

# Scale settings
gcloud run services update toftal-clip-api \
    --region $REGION \
    --min-instances 1 \
    --max-instances 20

# Redeploy
gcloud builds submit --tag gcr.io/$PROJECT_ID/toftal-clip-api && \
gcloud run deploy toftal-clip-api \
    --image gcr.io/$PROJECT_ID/toftal-clip-api \
    --region $REGION
```

---

## CI/CD with Cloud Build

The `cloudbuild.yaml` file is configured for automatic deployments:

```bash
# Connect your Git repository
gcloud builds triggers create github \
    --repo-name=toftal-clip-api \
    --repo-owner=your-username \
    --branch-pattern="^main$" \
    --build-config=cloudbuild.yaml

# Or trigger manually
gcloud builds submit --config cloudbuild.yaml
```

---

## Troubleshooting

### Database Connection Issues
```bash
# Check Cloud SQL instance status
gcloud sql instances describe toftal-clip-db

# Verify connection name in Cloud Run
gcloud run services describe toftal-clip-api --region $REGION \
    --format='value(spec.template.metadata.annotations)'
```

### View Application Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=toftal-clip-api" \
    --limit 50
```

### Health Check Failed
```bash
# Test locally first
docker build -t toftal-clip-api .
docker run -p 8080:8080 -e DATABASE_URL="..." toftal-clip-api
curl http://localhost:8080/health
```

---

## Cost Estimation (Monthly)

| Resource | Configuration | Est. Cost |
|----------|--------------|-----------|
| Cloud Run | 512Mi, min 0 instances | $0 - $50 |
| Cloud SQL | db-f1-micro | ~$8 |
| Container Registry | <1GB | ~$0.10 |
| Secret Manager | 3 secrets | ~$0.20 |
| **Total** | | **~$10 - $60** |

*Costs vary based on traffic. Cloud Run charges only when processing requests.*
