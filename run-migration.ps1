$envBackup = $null
$envExists = Test-Path '.env'
if ($envExists) {
    $envBackup = Get-Content '.env' -Raw
    Remove-Item '.env' -Force
}
$env:DATABASE_URL = 'postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip'
npx prisma migrate deploy
if ($envBackup -ne $null) {
    Set-Content '.env' -Value $envBackup
}
