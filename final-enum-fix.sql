-- Étape 1: S'assurer que toutes les colonnes sont présentes
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_mode_enabled" BOOLEAN DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_activation_date" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_questionnaire" JSONB;

-- Étape 2: Ajouter USER à l'enum s'il n'existe pas déjà
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'USER' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'UserRole')) THEN
        ALTER TYPE "UserRole" ADD VALUE 'USER';
    END IF;
END$$;

-- Étape 3: Migrer CLIENT -> USER avec talentModeEnabled=false
UPDATE "users"
SET role = 'USER', "talent_mode_enabled" = false  
WHERE role = 'CLIENT';

-- Étape 4: Migrer TALENT -> USER avec talentModeEnabled=true
UPDATE "users"
SET  
  role = 'USER',
  "talent_mode_enabled" = true,
  "talent_activation_date" = COALESCE("talent_activation_date", created_at)
WHERE role = 'TALENT';

-- Étape 5: Vérifier qu'il ne reste plus de CLIENT ou TALENT
-- SELECT role, COUNT(*) FROM "users" GROUP BY role;
