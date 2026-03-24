UPDATE "users" SET role = 'USER', "talent_mode_enabled" = false WHERE role = 'CLIENT';
UPDATE "users" SET role = 'USER', "talent_mode_enabled" = true, "talent_activation_date" = COALESCE("talent_activation_date", created_at) WHERE role = 'TALENT';
