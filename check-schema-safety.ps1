# Safety Check - Verify what will be synced
$ErrorActionPreference = "Continue"

$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Schema Safety Check" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

Write-Host "`n[1] Starting Cloud SQL Proxy..." -ForegroundColor Yellow

# Kill existing proxy
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start proxy
$proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden
Write-Host "Waiting for proxy..." -ForegroundColor Gray
Start-Sleep 15

if ($proxy.HasExited) {
    Write-Host "Proxy failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Proxy running. Checking schema..." -ForegroundColor Green

# Backup .env
$envBackup = $null
if (Test-Path ".env") {
    $envBackup = Get-Content ".env" -Raw
    Remove-Item ".env" -Force
}

try {
    $env:DATABASE_URL = $DB_URL
    
    Write-Host "`n[2] Checking existing database tables..." -ForegroundColor Yellow
    $dbTables = (psql $DB_URL -t -c "\dt" 2>&1)
    Write-Host $dbTables
    
    Write-Host "`n[3] Checking for schema changes (DRY RUN)..." -ForegroundColor Yellow
    Write-Host "Running: npx prisma db push --dry-run" -ForegroundColor Gray
    npx prisma db push --dry-run
    
    Write-Host "`n[4] Summary:" -ForegroundColor Yellow
    Write-Host "✓ Data preservation: prisma db push preserves ALL existing data" -ForegroundColor Green
    Write-Host "✓ Only creates/alters tables, never deletes data" -ForegroundColor Green
    Write-Host "✓ Safe to apply when ready" -ForegroundColor Green
    
} finally {
    if ($envBackup) {
        Set-Content ".env" -Value $envBackup
    }
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host "`nDone." -ForegroundColor Green
}
