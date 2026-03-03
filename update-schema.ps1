# ===========================================
# Toftal Clip - Update Database Schema Only
# ===========================================
# Usage: .\update-schema.ps1
# Synchronizes Prisma schema with production database
# Does NOT lose existing data
# ===========================================

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Toftal Clip - Update Schema" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "This will update the database schema." -ForegroundColor Yellow
Write-Host "Existing data will be preserved." -ForegroundColor Green
Write-Host ""

# Confirmation
$confirm = Read-Host "Continue? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "Aborted." -ForegroundColor Red
    exit
}

# Kill existing proxy
Write-Host "`n[1/4] Stopping existing Cloud SQL Proxy..." -ForegroundColor Yellow
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start Cloud SQL Proxy
Write-Host "`n[2/4] Starting Cloud SQL Proxy..." -ForegroundColor Yellow
$proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" `
    -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" `
    -PassThru -WindowStyle Hidden

Start-Sleep 8

if ($proxy.HasExited) {
    Write-Host "[ERROR] Proxy failed to start!" -ForegroundColor Red
    exit 1
}

Write-Host "[SUCCESS] Proxy running (PID: $($proxy.Id))" -ForegroundColor Green

try {
    # Backup .env
    Write-Host "`n[3/4] Preparing environment..." -ForegroundColor Yellow
    $envBackup = $null
    if (Test-Path ".env") {
        $envBackup = Get-Content ".env" -Raw
        Remove-Item ".env" -Force
    }

    # Set DATABASE_URL
    $env:DATABASE_URL = $DB_URL

    # Run prisma db push (updates schema without losing data)
    Write-Host "`n[4/4] Synchronizing schema..." -ForegroundColor Yellow
    Write-Host "Running: npx prisma db push" -ForegroundColor Gray
    npx prisma db push

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Schema update failed!" -ForegroundColor Red
        throw "Prisma db push failed"
    }

    Write-Host "[SUCCESS] Schema synchronized!" -ForegroundColor Green

} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    # Restore .env
    if ($envBackup) {
        Set-Content ".env" -Value $envBackup
    }

    # Stop proxy
    Write-Host "`nStopping Cloud SQL Proxy..." -ForegroundColor Yellow
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Schema Update Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
