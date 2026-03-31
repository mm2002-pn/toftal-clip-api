-- Migration: Add guest comment support to feedbacks table
-- Date: 2026-03-31
-- Description: Allow guest users to comment without authentication

-- Add guest_name column (nullable)
ALTER TABLE feedbacks ADD COLUMN guest_name VARCHAR(255);

-- Add guest_email column (nullable)
ALTER TABLE feedbacks ADD COLUMN guest_email VARCHAR(255);

-- Make author_id nullable to support guest comments
ALTER TABLE feedbacks ALTER COLUMN author_id DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN feedbacks.guest_name IS 'Name of guest commenter (for non-authenticated users)';
COMMENT ON COLUMN feedbacks.guest_email IS 'Email of guest commenter (for non-authenticated users)';
COMMENT ON COLUMN feedbacks.author_id IS 'User ID for authenticated comments, NULL for guest comments';
