$envBackup = $null
$envExists = Test-Path '.env'
if ($envExists) {
    $envBackup = Get-Content '.env' -Raw
    Remove-Item '.env' -Force
}

$env:DATABASE_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip?schema=public'

Write-Host "--- Running prisma migrate status ---"
npx prisma migrate status

if ($envExists) {
    Set-Content '.env' -Value $envBackup
}
