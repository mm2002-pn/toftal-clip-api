-- Étape 1: Migrer les données CLIENT -> USER
UPDATE "User"
SET role = 'USER', "talentModeEnabled" = false
WHERE role = 'CLIENT';

-- Étape 2: Migrer les données TALENT -> USER  
UPDATE "User"
SET
  role = 'USER',
  "talentModeEnabled" = true,
  "talentActivationDate" = COALESCE("talentActivationDate", CURRENT_TIMESTAMP)
WHERE role = 'TALENT';

-- Étape 3: Supprimer la valeur par défaut temporairement
ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;

-- Étape 4: Créer le nouvel enum
CREATE TYPE "UserRole_new" AS ENUM ('USER', 'ADMIN');

-- Étape 5: Convertir la colonne
ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new" USING (role::text::"UserRole_new");

-- Étape 6: Supprimer l'ancien enum
DROP TYPE "UserRole";

-- Étape 7: Renommer le nouvel enum
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

-- Étape 8: Remettre la valeur par défaut
ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'USER'::"UserRole";
