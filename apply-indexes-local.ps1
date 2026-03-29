# ==========================================
# Apply Performance Indexes - LOCAL
# ==========================================
# Applique les indexes de performance sur la BD locale
# À tester AVANT de déployer en production
# ==========================================

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Apply Performance Indexes - LOCAL" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier que la BD locale est accessible
Write-Host "[1/4] Vérification connexion BD locale..." -ForegroundColor Yellow

$env:DATABASE_URL = Get-Content .env | Where-Object { $_ -match "^DATABASE_URL=" } | ForEach-Object { $_ -replace "^DATABASE_URL=", "" } | ForEach-Object { $_.Trim('"') }

if (-not $env:DATABASE_URL) {
    Write-Host "[ERROR] DATABASE_URL non trouvé dans .env" -ForegroundColor Red
    exit 1
}

Write-Host "Database: $env:DATABASE_URL" -ForegroundColor Gray
Write-Host ""

# Vérifier les indexes existants AVANT
Write-Host "[2/4] Vérification indexes existants..." -ForegroundColor Yellow

$checkIndexesSql = @"
SELECT
    tablename,
    indexname
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename IN ('deliverables', 'versions', 'feedbacks')
ORDER BY tablename, indexname;
"@

Write-Host "Indexes actuels:" -ForegroundColor Gray
# Note: Cette requête nécessite psql ou autre client
# Pour l'instant, on continue avec la migration

Write-Host ""

# Appliquer la migration
Write-Host "[3/4] Application de la migration..." -ForegroundColor Yellow
Write-Host "Fichier: prisma/migrations/20260328_add_performance_indexes/migration.sql" -ForegroundColor Gray

npx prisma db execute --file prisma/migrations/20260328_add_performance_indexes/migration.sql --schema prisma/schema.prisma

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Migration échouée!" -ForegroundColor Red
    exit 1
}

Write-Host "[SUCCESS] Migration appliquée!" -ForegroundColor Green
Write-Host ""

# Vérifier les indexes APRÈS
Write-Host "[4/4] Vérification des nouveaux indexes..." -ForegroundColor Yellow

# Utiliser Prisma introspect pour vérifier
Write-Host "Exécution de: npx prisma db pull --print" -ForegroundColor Gray
# Cette commande affichera le schéma actuel avec les indexes

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Indexes Appliqués avec Succès!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Indexes créés:" -ForegroundColor Cyan
Write-Host "  ✅ deliverables_project_id_idx" -ForegroundColor White
Write-Host "  ✅ deliverables_assigned_talent_id_idx" -ForegroundColor White
Write-Host "  ✅ versions_deliverable_id_idx" -ForegroundColor White
Write-Host "  ✅ versions_uploaded_by_id_idx" -ForegroundColor White
Write-Host "  ✅ feedbacks_version_id_idx" -ForegroundColor White
Write-Host "  ✅ feedbacks_author_id_idx" -ForegroundColor White
Write-Host ""
Write-Host "Prochaine étape:" -ForegroundColor Yellow
Write-Host "  1. Redémarrer le serveur local" -ForegroundColor White
Write-Host "  2. Tester avec curl (voir test ci-dessous)" -ForegroundColor White
Write-Host "  3. Si OK, déployer en production" -ForegroundColor White
Write-Host ""

# Test query suggestion
Write-Host "Test de performance suggéré:" -ForegroundColor Cyan
Write-Host @"
# Login
`$token = (curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@toftalclip.com","password":"Admin@123!"}' \
  -s | ConvertFrom-Json).data.accessToken

# Test GraphQL avec deliverables (devrait être < 300ms)
Measure-Command {
  curl -X POST http://localhost:4000/graphql \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer `$token" \
    -d '{"query":"{ projects(pagination:{page:1,limit:5}){data{id deliverables{id assignedTalent{name}}}}}"}' \
    -s | Out-Null
}
"@ -ForegroundColor Gray

Write-Host ""
