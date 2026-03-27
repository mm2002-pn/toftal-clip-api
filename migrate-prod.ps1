$ErrorActionPreference = 'Continue'

$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '=== Stopping existing proxy ===' -ForegroundColor Yellow
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

Write-Host '=== Starting Cloud SQL Proxy ===' -ForegroundColor Yellow
$proxyArgs = @($DB_INSTANCE, '--port=5433')
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList $proxyArgs -PassThru -WindowStyle Hidden
Write-Host "Proxy started (PID: $($proxy.Id))"

Write-Host 'Waiting 30s...' -ForegroundColor Gray
Start-Sleep 30

# Check port binding
Write-Host '--- Port 5433 test ---' -ForegroundColor Cyan
$portTest = Test-NetConnection -ComputerName 127.0.0.1 -Port 5433 -WarningAction SilentlyContinue
Write-Host "TCP Test Succeeded: $($portTest.TcpTestSucceeded)"

if ($proxy.HasExited) {
    Write-Host 'ERROR: Proxy exited!' -ForegroundColor Red
    exit 1
}

# Set env
$envBackup = $null
$envExists = Test-Path '.env'
if ($envExists) {
    $envBackup = Get-Content '.env' -Raw
    Remove-Item '.env' -Force
}

$env:DATABASE_URL = $DB_URL

Write-Host '--- Running prisma migrate deploy ---' -ForegroundColor Yellow
node .\node_modules\prisma\build\index.js migrate deploy > migration_deploy_final.txt 2>&1
$res = Get-Content migration_deploy_final.txt | Out-String
Write-Host "Exit code: $LASTEXITCODE"

if ($envBackup -ne $null) {
    Set-Content '.env' -Value $envBackup
    Write-Host '.env restored'
}

Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
Write-Host 'Proxy stopped.'
