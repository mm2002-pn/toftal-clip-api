$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '=======================================' -ForegroundColor Cyan
Write-Host '  FINAL ENUM FIX' -ForegroundColor Cyan
Write-Host '=======================================' -ForegroundColor Cyan

Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

Write-Host 'Waiting 30 seconds...' -ForegroundColor Gray
for ($i = 30; $i -gt 0; $i--) {
    Write-Host -NoNewline "`r[$i]  "
    Start-Sleep 1
}
Write-Host ''

$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Executing final fix...' -ForegroundColor Yellow
    Get-Content final-enum-fix.sql | npx prisma db execute --stdin
    Write-Host 'SUCCESS! Enum fixed and data migrated!' -ForegroundColor Green
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}
