# ===========================================
# Toftal Clip - Full Deployment Script
# ===========================================
# Usage:
#   .\deploy.ps1                    # Deploy backend only
#   .\deploy.ps1 -Migrate           # Deploy + migrate database
#   .\deploy.ps1 -MigrateOnly       # Migrate database only
#   .\deploy.ps1 -Frontend          # Deploy frontend only
#   .\deploy.ps1 -All               # Deploy everything
# ===========================================

param(
    [switch]$Migrate,
    [switch]$MigrateOnly,
    [switch]$Frontend,
    [switch]$All
)

$ErrorActionPreference = "Continue"

# Configuration
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$SERVICE_NAME = "toftal-clip-api"
$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"
$BACKEND_PATH = "C:\xampp\htdocs\toftal-clip-api"
$FRONTEND_PATH = "C:\xampp\htdocs\toftal-clip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Toftal Clip - Deployment Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ===========================================
# Function: Migrate Database
# ===========================================
function Invoke-Migration {
    Write-Host "`n[DATABASE] Starting migration..." -ForegroundColor Yellow
    Set-Location $BACKEND_PATH

    # Kill existing proxy
    Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3

    # Start Cloud SQL Proxy with gcloud auth
    Write-Host "[DATABASE] Starting Cloud SQL Proxy..." -ForegroundColor Gray
    $proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden

    Start-Sleep 12

    if (-not $proxy.HasExited) {
        Write-Host "[DATABASE] Proxy running (PID: $($proxy.Id))" -ForegroundColor Green

        # Backup and remove .env temporarily
        $envBackup = $null
        if (Test-Path ".env") {
            $envBackup = Get-Content ".env" -Raw
            Remove-Item ".env" -Force
        }

        # Set DATABASE_URL and run prisma
        $env:DATABASE_URL = $DB_URL
        Write-Host "[DATABASE] Running prisma db push..." -ForegroundColor Gray
        npx prisma db push --accept-data-loss

        # Restore .env
        if ($envBackup) {
            Set-Content ".env" -Value $envBackup
        }

        # Stop proxy
        Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
        Write-Host "[DATABASE] Migration complete!" -ForegroundColor Green
    } else {
        Write-Host "[DATABASE] Proxy failed to start!" -ForegroundColor Red
        return $false
    }
    return $true
}

# ===========================================
# Function: Deploy Backend
# ===========================================
function Invoke-BackendDeploy {
    Write-Host "`n[BACKEND] Starting deployment..." -ForegroundColor Yellow
    Set-Location $BACKEND_PATH

    # Set project
    gcloud config set project $PROJECT_ID 2>$null

    # Build
    Write-Host "[BACKEND] Building Docker image..." -ForegroundColor Gray
    gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE_NAME" --quiet

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[BACKEND] Build failed!" -ForegroundColor Red
        return $false
    }

    # Load environment variables from .env for secrets (excluding API keys that should be set via Cloud Console)
    $envContent = Get-Content "$BACKEND_PATH\.env" -Raw
    $emailPass = ($envContent | Select-String 'EMAIL_PASSWORD=(.+)').Matches.Groups[1].Value
    $rateLimitMax = ($envContent | Select-String 'RATE_LIMIT_MAX=(.+)').Matches.Groups[1].Value

    # Note: GROQ_API_KEY is set directly in Cloud Run console for security
    # Deploy
    Write-Host "[BACKEND] Deploying to Cloud Run..." -ForegroundColor Gray
    gcloud run deploy $SERVICE_NAME `
        --image "gcr.io/$PROJECT_ID/$SERVICE_NAME" `
        --region $REGION `
        --timeout 900 `
        --memory 2Gi `
        --cpu 2 `
        --max-instances 10 `
        --set-env-vars "TRUST_PROXY=true,CORS_ORIGIN=https://toftal-clip.netlify.app;https://toftal-clip-test.netlify.app,NODE_ENV=production,FRONTEND_URL=https://toftal-clip.netlify.app,EMAIL_SERVICE=gmail,EMAIL_USER=toftalpodium@gmail.com,EMAIL_FROM=Toftal Clip <toftalpodium@gmail.com>,EMAIL_PASSWORD=$emailPass,RATE_LIMIT_MAX=$rateLimitMax" `
        --quiet

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[BACKEND] Deploy failed!" -ForegroundColor Red
        return $false
    }

    # Get URL
    $serviceUrl = gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)'
    Write-Host "[BACKEND] Deployed to: $serviceUrl" -ForegroundColor Green

    # Health check
    try {
        $health = Invoke-RestMethod -Uri "$serviceUrl/health" -Method Get
        Write-Host "[BACKEND] Health: $($health.status)" -ForegroundColor Green
    } catch {
        Write-Host "[BACKEND] Health check failed" -ForegroundColor Red
    }

    return $true
}

# ===========================================
# Function: Deploy Frontend
# ===========================================
function Invoke-FrontendDeploy {
    Write-Host "`n[FRONTEND] Starting deployment..." -ForegroundColor Yellow
    Set-Location $FRONTEND_PATH

    # Build
    Write-Host "[FRONTEND] Building..." -ForegroundColor Gray
    npm run build

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FRONTEND] Build failed!" -ForegroundColor Red
        return $false
    }

    # Deploy to Netlify
    Write-Host "[FRONTEND] Deploying to Netlify..." -ForegroundColor Gray
    netlify deploy --prod

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FRONTEND] Deploy failed!" -ForegroundColor Red
        return $false
    }

    Write-Host "[FRONTEND] Deployed to: https://toftal-clip.netlify.app" -ForegroundColor Green
    return $true
}

# ===========================================
# Main Execution
# ===========================================

if ($All) {
    $Migrate = $true
    $Frontend = $true
}

# Migrate only
if ($MigrateOnly) {
    Invoke-Migration
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host "  Migration Complete!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    exit
}

# Backend deploy
if (-not $Frontend -or $All) {
    Invoke-BackendDeploy
}

# Migrate if requested
if ($Migrate) {
    Invoke-Migration
}

# Frontend deploy
if ($Frontend) {
    Invoke-FrontendDeploy
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Backend:  https://toftal-clip-api-776016345965.europe-west1.run.app" -ForegroundColor Cyan
Write-Host "Frontend: https://toftal-clip.netlify.app" -ForegroundColor Cyan
Write-Host ""
