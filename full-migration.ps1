$ErrorActionPreference = 'Continue'
$DB_INSTANCE = 'toftal-clip-api:europe-west1:toftal-clip-db'
$DB_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Migration Complete - Production DB' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# Kill any existing proxy
Write-Host 'Cleaning up existing processes...' -ForegroundColor Yellow
Get-Process cloud_sql_proxy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# Start proxy
Write-Host 'Starting Cloud SQL Proxy...' -ForegroundColor Yellow
$proxy = Start-Process -FilePath '.\cloud_sql_proxy.exe' -ArgumentList '--gcloud-auth', $DB_INSTANCE, '--port=5433' -PassThru -WindowStyle Hidden

# Wait
Write-Host 'Waiting 45 seconds for proxy...' -ForegroundColor Gray
for ($i = 45; $i -gt 0; $i--) {
    Write-Host -NoNewline "`r[$i] Waiting...  "
    Start-Sleep 1
}
Write-Host ''

if ($proxy.HasExited) {
    Write-Host 'ERROR: Proxy exited!' -ForegroundColor Red
    exit 1
}

Write-Host 'Proxy OK (PID: ' $proxy.Id ')' -ForegroundColor Green

# Setup environment
$env:DATABASE_URL = $DB_URL

try {
    # Migrate roles avec talentModeEnabled
    Write-Host '1. Migrating old roles with talentModeEnabled...' -ForegroundColor Yellow
    Get-Content migrate-roles-complete.sql | npx prisma db execute --stdin
    Write-Host 'SUCCESS: Roles migrated!' -ForegroundColor Green
    
    # Sync schema
    Write-Host '2. Syncing schema...' -ForegroundColor Yellow
    npx prisma db push --skip-generate --accept-data-loss
    Write-Host 'SUCCESS: Schema synchronized!' -ForegroundColor Green
} catch {
    Write-Host 'ERROR: ' $_.Exception.Message -ForegroundColor Red
} finally {
    Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
    Write-Host 'Proxy stopped.' -ForegroundColor Gray
}
