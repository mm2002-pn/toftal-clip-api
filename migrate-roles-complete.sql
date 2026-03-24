-- Migration CLIENT -> USER avec talentModeEnabled = false
UPDATE "User"
SET role = 'USER', "talentModeEnabled" = false
WHERE role = 'CLIENT';

-- Migration TALENT -> USER avec talentModeEnabled = true
UPDATE "User"
SET
  role = 'USER',
  "talentModeEnabled" = true,
  "talentActivationDate" = COALESCE("talentActivationDate", CURRENT_TIMESTAMP)
WHERE role = 'TALENT';
