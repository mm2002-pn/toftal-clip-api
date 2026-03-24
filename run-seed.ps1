$ErrorActionPreference = 'Stop'
$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Running Database Seed' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

Write-Host 'Starting proxy...' -ForegroundColor Yellow
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

Write-Host 'Waiting 45 seconds...' -ForegroundColor Gray
for ($i = 45; $i -gt 0; $i--) {
    if ($proxy.HasExited) {
        Write-Host "`nProxy exited!" -ForegroundColor Red
        exit 1
    }
    Write-Host -NoNewline "`r[$i]  "
    Start-Sleep 1
}
Write-Host ''

$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Running seed...' -ForegroundColor Yellow
    npx prisma db seed
    Write-Host 'SUCCESS: Seed completed!' -ForegroundColor Green
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}
