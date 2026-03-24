ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_mode_enabled" BOOLEAN DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_activation_date" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "talent_questionnaire" JSONB;

UPDATE "users" SET "talent_mode_enabled" = true, "talent_activation_date" = COALESCE("talent_activation_date", created_at) 
WHERE role = 'USER' AND EXISTS (SELECT 1 FROM "TalentProfile" WHERE "TalentProfile"."userId" = "users".id);
