$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

Write-Host 'Starting proxy...' -ForegroundColor Yellow
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

Write-Host 'Waiting 30 seconds...' -ForegroundColor Gray
for ($i = 30; $i -gt 0; $i--) {
    Write-Host -NoNewline "`r[$i]  "
    Start-Sleep 1
}
Write-Host ''

$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Checking migrations...' -ForegroundColor Yellow
    npx prisma migrate status
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}
