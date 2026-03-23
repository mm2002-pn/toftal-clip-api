-- Step 1: Add talent mode columns to User table
ALTER TABLE "users" ADD COLUMN "talent_mode_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "talent_activation_date" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "talent_questionnaire" JSONB;

-- Step 2: Create TalentModeActivationLog table
CREATE TABLE "talent_mode_activation_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "questionnaire" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "talent_mode_activation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 3: Create indexes for performance
CREATE INDEX "talent_mode_activation_logs_user_id_idx" ON "talent_mode_activation_logs"("user_id");
CREATE INDEX "talent_mode_activation_logs_created_at_idx" ON "talent_mode_activation_logs"("created_at");

-- Step 4: Migrate data - ALL users with role='TALENT' get talentModeEnabled=true
-- WARNING: This is a one-time migration. Before running, verify the TALENT count:
-- SELECT COUNT(*) FROM "users" WHERE role = 'TALENT';
-- After migration, verify with:
-- SELECT COUNT(*) FROM "users" WHERE "talent_mode_enabled" = true;
UPDATE "users" SET "talent_mode_enabled" = true WHERE role = 'TALENT';
UPDATE "users" SET "talent_activation_date" = "created_at" WHERE role = 'TALENT' AND "talent_mode_enabled" = true;

-- Step 5: Verify migration (check counts)
-- SELECT
--   COUNT(*) as total_users,
--   COUNT(CASE WHEN "talent_mode_enabled" = true THEN 1 END) as talent_mode_enabled_count,
--   COUNT(CASE WHEN role = 'TALENT' THEN 1 END) as old_talent_role_count
-- FROM "users";
-- Both talent counts should match after this migration
