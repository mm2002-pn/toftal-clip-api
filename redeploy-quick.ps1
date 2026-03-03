# Quick Redeploy Script
$ErrorActionPreference = "Stop"
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$SERVICE_NAME = "toftal-clip-api"

Write-Host "Building and deploying..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID
gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME" --quiet
gcloud run deploy $SERVICE_NAME --image "gcr.io/$PROJECT_ID/$SERVICE_NAME" --region $REGION --quiet

$serviceUrl = gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'
Write-Host "Deployed to: $serviceUrl" -ForegroundColor Green
