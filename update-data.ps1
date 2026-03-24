$ErrorActionPreference = 'Continue'
$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '======================================' -ForegroundColor Cyan
Write-Host '  Updating Talent Flags' -ForegroundColor Cyan
Write-Host '======================================' -ForegroundColor Cyan

Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden
Start-Sleep 10
$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Updating talent flags...' -ForegroundColor Yellow
    Get-Content update-talent-flags.sql | npx prisma db execute --stdin
    Write-Host 'SUCCESS!' -ForegroundColor Green
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}
