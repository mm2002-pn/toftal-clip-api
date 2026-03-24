$ErrorActionPreference = 'Continue'
$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Manual Enum Migration - Production' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# Kill existing proxy
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# Start proxy
Write-Host 'Starting Cloud SQL Proxy...' -ForegroundColor Yellow
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

Write-Host 'Waiting 45 seconds...' -ForegroundColor Gray
for ($i = 45; $i -gt 0; $i--) {
    Write-Host -NoNewline "`r[$i] Waiting...  "
    Start-Sleep 1
}
Write-Host ''

if ($proxy.HasExited) {
    Write-Host 'ERROR: Proxy exited!' -ForegroundColor Red
    exit 1
}

Write-Host 'Proxy OK' -ForegroundColor Green
$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Executing manual enum migration...' -ForegroundColor Yellow
    Get-Content migrate-enum-manual.sql | npx prisma db execute --stdin
    Write-Host 'SUCCESS: Migration executed!' -ForegroundColor Green
} catch {
    Write-Host 'ERROR: ' $_.Exception.Message -ForegroundColor Red
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host 'Done!' -ForegroundColor Green
}
