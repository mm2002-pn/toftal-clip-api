-- ==========================================
-- Vérification des Indexes de Performance
-- ==========================================
-- Exécuter avec: psql $DATABASE_URL < verify-indexes.sql
-- ==========================================

\echo '=========================================='
\echo 'Vérification des Indexes de Performance'
\echo '=========================================='
\echo ''

\echo 'Indexes sur DELIVERABLES:'
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename = 'deliverables'
    AND indexname LIKE '%project_id%' OR indexname LIKE '%assigned_talent%'
ORDER BY indexname;

\echo ''
\echo 'Indexes sur VERSIONS:'
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename = 'versions'
    AND (indexname LIKE '%deliverable_id%' OR indexname LIKE '%uploaded_by%')
ORDER BY indexname;

\echo ''
\echo 'Indexes sur FEEDBACKS:'
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename = 'feedbacks'
    AND (indexname LIKE '%version_id%' OR indexname LIKE '%author%')
ORDER BY indexname;

\echo ''
\echo 'RÉSUMÉ - Tous les indexes critiques:'
SELECT
    tablename,
    COUNT(*) as nb_indexes
FROM pg_indexes
WHERE schemaname = 'public'
    AND tablename IN ('deliverables', 'versions', 'feedbacks')
GROUP BY tablename
ORDER BY tablename;

\echo ''
\echo '✅ Vérification terminée!'
\echo ''
