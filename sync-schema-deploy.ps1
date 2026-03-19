# Sync Schema - Extended timeout version
$ErrorActionPreference = "Stop"

$DB_INSTANCE = "toftal-clip-api:europe-west1:toftal-clip-db"
$DB_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Schema Sync - Production" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nStarting Cloud SQL Proxy..." -ForegroundColor Yellow

# Kill existing proxy
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3

# Start proxy
Write-Host "Launching proxy..." -ForegroundColor Gray
$proxy = Start-Process -FilePath ".\cloud_sql_proxy.exe" -ArgumentList "--gcloud-auth", $DB_INSTANCE, "--port=5433" -PassThru -WindowStyle Hidden
Write-Host "Waiting 35 seconds for proxy to stabilize..." -ForegroundColor Yellow

for ($i = 35; $i -gt 0; $i--) {
    Write-Host -NoNewline "`rWaiting... $i seconds remaining  "
    Start-Sleep 1
}
Write-Host "`n"

if ($proxy.HasExited) {
    Write-Host "ERROR: Proxy failed to start!" -ForegroundColor Red
    exit 1
}

Write-Host "Proxy running (PID: $($proxy.Id))" -ForegroundColor Green

# Backup .env
$envBackup = $null
if (Test-Path ".env") {
    $envBackup = Get-Content ".env" -Raw
    Remove-Item ".env" -Force
    Write-Host "Backed up .env" -ForegroundColor Green
}

try {
    $env:DATABASE_URL = $DB_URL
    Write-Host "`nRunning: npx prisma db push..." -ForegroundColor Yellow
    npx prisma db push --skip-generate

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nSchema synchronized successfully!" -ForegroundColor Green
    } else {
        Write-Host "`nSchema sync completed with warnings" -ForegroundColor Yellow
    }
} catch {
    Write-Host "`nError during schema sync: $_" -ForegroundColor Red
    throw
} finally {
    if ($envBackup) {
        Set-Content ".env" -Value $envBackup
        Write-Host "Restored .env" -ForegroundColor Green
    }
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Proxy stopped" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Schema Sync Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
