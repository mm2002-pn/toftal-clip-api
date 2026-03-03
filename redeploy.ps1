# ===========================================
# Toftal Clip API - Redeploy Script
# ===========================================

param(
    [switch]$Migrate,   # Ajouter -Migrate pour migrer la DB
    [switch]$Seed,      # Ajouter -Seed pour lancer le seeder
    [switch]$SkipBuild  # Ajouter -SkipBuild pour deployer sans rebuild
)

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$SERVICE_NAME = "toftal-clip-api"
$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Toftal Clip API - Redeploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Set project
gcloud config set project $PROJECT_ID 2>$null

# ==========================================
# Migration / Seed (optionnel)
# ==========================================
if ($Migrate -or $Seed) {
    Write-Host "`nOperation sur la base de donnees..." -ForegroundColor Yellow

    # Backup .env
    $envBackup = Get-Content .env -Raw

    # Update .env temporarily
    $newEnv = $envBackup -replace 'DATABASE_URL="[^"]+"', "DATABASE_URL=`"$DB_URL`""
    Set-Content .env -Value $newEnv

    # Start proxy in background
    Write-Host "Demarrage du proxy Cloud SQL..." -ForegroundColor Gray
    $proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden

    Start-Sleep -Seconds 4

    try {
        # Run migrations
        if ($Migrate) {
            Write-Host "Execution de prisma db push..." -ForegroundColor Gray
            npx prisma db push --skip-generate
            Write-Host "Migration terminee!" -ForegroundColor Green
        }

        # Run seeder
        if ($Seed) {
            Write-Host "Execution du seeder..." -ForegroundColor Gray
            npx prisma db seed
            Write-Host "Seeding termine!" -ForegroundColor Green
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
    Write-Host "`nConstruction de l'image Docker..." -ForegroundColor Yellow

    gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME" --quiet

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur lors du build!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build termine!" -ForegroundColor Green
}

# ==========================================
# Deploy
# ==========================================
Write-Host "`nDeploiement sur Cloud Run..." -ForegroundColor Yellow

gcloud run deploy $SERVICE_NAME `
    --image "gcr.io/$PROJECT_ID/$SERVICE_NAME" `
    --region $REGION `
    --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur lors du deploiement!" -ForegroundColor Red
    exit 1
}

# Get service URL
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Deploiement reussi!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "URL: $SERVICE_URL" -ForegroundColor Cyan
Write-Host ""

# Test health
Write-Host "Test du health check..." -ForegroundColor Gray
try {
    $health = Invoke-RestMethod -Uri "$SERVICE_URL/health" -Method Get
    Write-Host "Status: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed" -ForegroundColor Red
}
