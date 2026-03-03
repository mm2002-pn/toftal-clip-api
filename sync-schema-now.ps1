# Sync Schema - Auto mode (no confirmation)
$ErrorActionPreference = "Stop"

$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "Starting Cloud SQL Proxy..." -ForegroundColor Yellow

# Kill existing proxy
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start proxy
$proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden
Write-Host "Waiting for proxy to be ready..." -ForegroundColor Gray
Start-Sleep 20
Write-Host "Testing connection..." -ForegroundColor Gray

if ($proxy.HasExited) {
    Write-Host "Proxy failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Proxy running. Syncing schema..." -ForegroundColor Yellow

# Backup .env
$envBackup = $null
if (Test-Path ".env") {
    $envBackup = Get-Content ".env" -Raw
    Remove-Item ".env" -Force
}

try {
    $env:DATABASE_URL = $DB_URL
    npx prisma db push

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Schema synchronized successfully!" -ForegroundColor Green
    } else {
        Write-Host "Schema sync failed!" -ForegroundColor Red
    }
} finally {
    if ($envBackup) {
        Set-Content ".env" -Value $envBackup
    }
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
}
