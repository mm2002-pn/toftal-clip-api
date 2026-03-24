$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden
Start-Sleep 20
$env:DATABASE_URL = $DB_URL

try {
    Write-Host 'Pulling schema from production...' -ForegroundColor Yellow
    Copy-Item prisma\schema.prisma prisma\schema.prisma.backup
    npx prisma db pull --force
    Write-Host 'SUCCESS! Check schema.prisma for production state' -ForegroundColor Green
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
}
