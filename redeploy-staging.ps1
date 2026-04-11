# ===========================================
# Toftal Clip API - Redeploy Script (STAGING)
# ===========================================
# Ce script deploie l'API en mode STAGING
# avec une base de donnees separee de la PROD

param(
    [switch]$Migrate,   # Ajouter -Migrate pour migrer la DB staging
    [switch]$Seed,      # Ajouter -Seed pour lancer le seeder staging
    [switch]$SkipBuild  # Ajouter -SkipBuild pour deployer sans rebuild
)

$ErrorActionPreference = "Continue"

# Configuration STAGING
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$SERVICE_NAME = "toftal-clip-api-staging"  # Service STAGING separe de PROD
$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@localhost:5433/toftal_staging_studio_db?schema=public"  # Base STAGING

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Toftal Clip API - Redeploy STAGING" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Set project
gcloud config set project $PROJECT_ID 2>&1 | Out-Null

# ==========================================
# Migration / Seed (optionnel)
# ==========================================
if ($Migrate -or $Seed) {
    Write-Host "`nOperation sur la base de donnees STAGING..." -ForegroundColor Yellow

    # Backup .env
    $envBackup = Get-Content .env -Raw

    # Update .env temporarily pour STAGING
    $newEnv = $envBackup -replace 'DATABASE_URL="[^"]+"', "DATABASE_URL=`"$DB_URL`""
    $newEnv = $newEnv -replace 'NODE_ENV=.*', "NODE_ENV=staging"
    Set-Content .env -Value $newEnv

    # Start proxy in background (optionnel, si vous utilisez Cloud SQL)
    Write-Host "Demarrage du proxy Cloud SQL..." -ForegroundColor Gray
    $proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 4

    try {
        # Run migrations
        if ($Migrate) {
            Write-Host "Execution de prisma db push (STAGING)..." -ForegroundColor Gray
            npx prisma db push --accept-data-loss
            Write-Host "Migration STAGING terminee!" -ForegroundColor Green
        }

        # Run seeder
        if ($Seed) {
            Write-Host "Execution du seeder (STAGING)..." -ForegroundColor Gray
            npx prisma db seed
            Write-Host "Seeding STAGING termine!" -ForegroundColor Green
        }
    }
    finally {
        # Stop proxy
        Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue

        # Restore .env
        Set-Content .env -Value $envBackup
    }
}

# ==========================================
# Build
# ==========================================
if (-not $SkipBuild) {
    Write-Host "`nConstruction de l'image Docker STAGING..." -ForegroundColor Yellow

    gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME" --quiet

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur lors du build!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build STAGING termine!" -ForegroundColor Green
}

# ==========================================
# Deploy
# ==========================================
Write-Host "`nDeploiement STAGING sur Cloud Run..." -ForegroundColor Yellow

gcloud run deploy $SERVICE_NAME `
    --image "gcr.io/$PROJECT_ID/$SERVICE_NAME" `
    --region $REGION `
    --set-env-vars "TRUST_PROXY=true,CORS_ORIGIN=https://toftalclip.io;https://staging.toftalclip.io;https://toftal-clip.netlify.app;https://toftal-clip-test.netlify.app,NODE_ENV=staging,FRONTEND_URL=https://toftalclip.io,EMAIL_SERVICE=gmail,EMAIL_USER=toftalpodium@gmail.com,EMAIL_FROM=Toftal Clip toftalpodium@gmail.com,RATE_LIMIT_MAX=1000,DB_CONNECTION_LIMIT=10,DB_POOL_TIMEOUT=30,GCS_BUCKET_NAME=toftal-clip-media,GCP_PROJECT_ID=toftal-clip-api,UPSTASH_REDIS_REST_URL=https://mint-polecat-37123.upstash.io" `
    --set-secrets "DATABASE_URL=DATABASE_URL_STAGING:latest,JWT_SECRET=JWT_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest,EMAIL_PASSWORD=EMAIL_PASSWORD:latest,GROQ_API_KEY=GROQ_API_KEY:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest" `
    --set-cloudsql-instances=toftal-clip-api:europe-west1:toftal-clip-db `
    --min-instances=2 `
    --max-instances=10 `
    --memory=1Gi `
    --cpu=1 `
    --timeout=3600 `
    --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur lors du deploiement STAGING!" -ForegroundColor Red
    exit 1
}

# Get service URL
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Deploiement STAGING reussi!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "URL: $SERVICE_URL" -ForegroundColor Cyan
Write-Host "Mode: STAGING" -ForegroundColor Cyan
Write-Host "Base de donnees: toftal_staging_studio_db" -ForegroundColor Cyan
Write-Host ""

# Test health
Write-Host "Test du health check..." -ForegroundColor Gray
try {
    $health = Invoke-RestMethod -Uri "$SERVICE_URL/health" -Method Get
    Write-Host "Status: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed" -ForegroundColor Red
}
