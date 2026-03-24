$ErrorActionPreference = 'Stop'
$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Deploying Prisma Migrations' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# Clean up
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# Start proxy
Write-Host 'Starting Cloud SQL Proxy...' -ForegroundColor Yellow
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

# Wait with progress
Write-Host 'Waiting 60 seconds for proxy...' -ForegroundColor Gray
for ($i = 60; $i -gt 0; $i--) {
    if ($proxy.HasExited) {
        Write-Host "`nERROR: Proxy exited!" -ForegroundColor Red
        exit 1
    }
    Write-Host -NoNewline "`r[$i] seconds  "
    Start-Sleep 1
}
Write-Host "`nProxy should be ready (PID: $($proxy.Id))" -ForegroundColor Green

# Test connection
Write-Host 'Testing connection...' -ForegroundColor Yellow
Start-Sleep 5

$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Deploying migrations...' -ForegroundColor Yellow
    npx prisma migrate deploy
    Write-Host 'SUCCESS: All migrations deployed!' -ForegroundColor Green
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host 'Proxy stopped.' -ForegroundColor Gray
}
