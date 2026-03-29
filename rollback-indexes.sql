-- ==========================================
-- ROLLBACK: Remove Performance Indexes
-- ==========================================
-- ⚠️  ATTENTION: À utiliser seulement si problème!
-- Les indexes n'ont PAS d'effet négatif normalement
-- ==========================================

-- Drop indexes sur deliverables
DROP INDEX IF EXISTS "deliverables_project_id_idx";
DROP INDEX IF EXISTS "deliverables_assigned_talent_id_idx";

-- Drop indexes sur versions
DROP INDEX IF EXISTS "versions_deliverable_id_idx";
DROP INDEX IF EXISTS "versions_uploaded_by_id_idx";

-- Drop indexes sur feedbacks
DROP INDEX IF EXISTS "feedbacks_version_id_idx";
DROP INDEX IF EXISTS "feedbacks_author_id_idx";

-- ==========================================
-- ✅ Indexes supprimés
-- Note: La performance sera PIRE après ce rollback
-- ==========================================
