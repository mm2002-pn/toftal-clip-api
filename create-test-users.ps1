# ===========================================
# Toftal Clip - Create Load Test Users
# ===========================================
# Usage: .\create-test-users.ps1
# Creates 50 test users for K6 load testing
# ===========================================

$ErrorActionPreference = "Stop"

# Configuration (même que update-schema.ps1)
$PROJECT_ID = "toftal-clip-api"
$REGION = "europe-west1"
$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Toftal Clip - Create Test Users" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "This will create 50 test users in production." -ForegroundColor Yellow
Write-Host "Email: loadtest_user1@test.com to loadtest_user50@test.com" -ForegroundColor Yellow
Write-Host "Password: LoadTest@123!" -ForegroundColor Yellow
Write-Host ""

# Confirmation
$confirm = Read-Host "Continue? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "Aborted." -ForegroundColor Red
    exit
}

# Kill existing proxy
Write-Host "`n[1/3] Stopping existing Cloud SQL Proxy..." -ForegroundColor Yellow
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start Cloud SQL Proxy
Write-Host "`n[2/3] Starting Cloud SQL Proxy..." -ForegroundColor Yellow
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
    Write-Host "`n[3/3] Creating test users..." -ForegroundColor Yellow
    $envBackup = $null
    if (Test-Path ".env") {
        $envBackup = Get-Content ".env" -Raw
        Remove-Item ".env" -Force
    }

    # Set environment variables
    $env:DATABASE_URL = $DB_URL
    $env:ALLOW_TEST_USERS_IN_PROD = "true"
    $env:NODE_ENV = "production"

    # Run script
    Write-Host "Running: npx ts-node scripts/create-test-users.ts" -ForegroundColor Gray
    npx ts-node scripts/create-test-users.ts

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] User creation failed!" -ForegroundColor Red
        throw "Script failed"
    }

    Write-Host "`n[SUCCESS] 50 test users created!" -ForegroundColor Green

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
Write-Host "  Test Users Created!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Credentials:" -ForegroundColor Cyan
Write-Host "  Email: loadtest_user{1-50}@test.com" -ForegroundColor White
Write-Host "  Password: LoadTest@123!" -ForegroundColor White
Write-Host ""
Write-Host "Next step: Run K6 load test" -ForegroundColor Yellow
Write-Host "  k6 run load-test-k6.js" -ForegroundColor Gray
Write-Host ""
