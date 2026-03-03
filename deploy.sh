#!/bin/bash

# ===========================================
# Toftal Clip API - Cloud Run Deployment Script
# ===========================================

set -e

# Configuration - MODIFY THESE VALUES
PROJECT_ID="toftal-clip-api"
REGION="europe-west1"
SERVICE_NAME="toftal-clip-api"
DB_INSTANCE_NAME="toftal-clip-db"
DB_NAME="toftal_clip"
DB_USER="toftal_user"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Toftal Clip API - Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set project
echo -e "\n${YELLOW}Setting GCP project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "\n${YELLOW}Enabling required APIs...${NC}"
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    containerregistry.googleapis.com

# ==========================================
# STEP 1: Create Cloud SQL PostgreSQL instance
# ==========================================
echo -e "\n${YELLOW}Step 1: Creating Cloud SQL instance...${NC}"

# Check if instance already exists
if gcloud sql instances describe $DB_INSTANCE_NAME --project=$PROJECT_ID &> /dev/null; then
    echo -e "${GREEN}Cloud SQL instance already exists${NC}"
else
    echo "Creating new Cloud SQL instance (this may take 5-10 minutes)..."
    gcloud sql instances create $DB_INSTANCE_NAME \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --storage-type=SSD \
        --storage-size=10GB \
        --storage-auto-increase \
        --backup-start-time=03:00 \
        --maintenance-window-day=SUN \
        --maintenance-window-hour=04

    echo -e "${GREEN}Cloud SQL instance created!${NC}"
fi

# ==========================================
# STEP 2: Create database and user
# ==========================================
echo -e "\n${YELLOW}Step 2: Creating database and user...${NC}"

# Generate random password
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 24)

# Create user
gcloud sql users create $DB_USER \
    --instance=$DB_INSTANCE_NAME \
    --password=$DB_PASSWORD \
    2>/dev/null || echo "User may already exist, continuing..."

# Create database
gcloud sql databases create $DB_NAME \
    --instance=$DB_INSTANCE_NAME \
    2>/dev/null || echo "Database may already exist, continuing..."

# Get instance connection name
INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe $DB_INSTANCE_NAME --format='value(connectionName)')

echo -e "${GREEN}Database configured!${NC}"
echo -e "Instance connection name: ${INSTANCE_CONNECTION_NAME}"

# ==========================================
# STEP 3: Create secrets in Secret Manager
# ==========================================
echo -e "\n${YELLOW}Step 3: Creating secrets...${NC}"

# Database URL for Cloud SQL with Unix socket
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"

# Create or update secrets
create_secret() {
    local name=$1
    local value=$2

    if gcloud secrets describe $name --project=$PROJECT_ID &> /dev/null; then
        echo "$value" | gcloud secrets versions add $name --data-file=-
        echo "Updated secret: $name"
    else
        echo "$value" | gcloud secrets create $name --data-file=-
        echo "Created secret: $name"
    fi
}

create_secret "DATABASE_URL" "$DATABASE_URL"
create_secret "JWT_SECRET" "$(openssl rand -base64 48)"
create_secret "JWT_REFRESH_SECRET" "$(openssl rand -base64 48)"

echo -e "${GREEN}Secrets created!${NC}"

# ==========================================
# STEP 4: Build and push Docker image
# ==========================================
echo -e "\n${YELLOW}Step 4: Building and pushing Docker image...${NC}"

# Build image
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

echo -e "${GREEN}Docker image built and pushed!${NC}"

# ==========================================
# STEP 5: Deploy to Cloud Run
# ==========================================
echo -e "\n${YELLOW}Step 5: Deploying to Cloud Run...${NC}"

# Get the Cloud Run service account
SERVICE_ACCOUNT="$(gcloud iam service-accounts list --filter='displayName:Compute Engine default service account' --format='value(email)')"

# Grant Secret Manager access
gcloud secrets add-iam-policy-binding DATABASE_URL \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding JWT_SECRET \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding JWT_REFRESH_SECRET \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --add-cloudsql-instances $INSTANCE_CONNECTION_NAME \
    --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest" \
    --set-env-vars="NODE_ENV=production,API_VERSION=v1,JWT_EXPIRES_IN=15m,JWT_REFRESH_EXPIRES_IN=7d,CORS_ORIGIN=*" \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --timeout 300

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)')

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nService URL: ${SERVICE_URL}"
echo -e "Health Check: ${SERVICE_URL}/health"
echo -e "GraphQL: ${SERVICE_URL}/graphql"
echo -e "REST API: ${SERVICE_URL}/api/v1"
echo -e "\n${YELLOW}Important:${NC}"
echo -e "- Add your Cloudinary and Gemini API keys as secrets"
echo -e "- Update CORS_ORIGIN with your frontend URL"
echo -e "- Run database migrations (see instructions below)"

# ==========================================
# STEP 6: Run Prisma migrations
# ==========================================
echo -e "\n${YELLOW}To run database migrations, execute:${NC}"
echo -e "1. Install Cloud SQL Proxy: https://cloud.google.com/sql/docs/postgres/sql-proxy"
echo -e "2. Run: cloud_sql_proxy -instances=${INSTANCE_CONNECTION_NAME}=tcp:5432"
echo -e "3. In another terminal, set DATABASE_URL and run:"
echo -e "   export DATABASE_URL=\"postgresql://${DB_USER}:YOUR_PASSWORD@localhost:5432/${DB_NAME}\""
echo -e "   npx prisma migrate deploy"
echo -e "   npx prisma db seed"
