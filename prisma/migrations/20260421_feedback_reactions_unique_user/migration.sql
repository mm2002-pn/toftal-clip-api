-- ==========================================
-- Migration: Enforce one-reaction-per-user-per-feedback
-- Date: 2026-04-21
-- Description: Switch the unique key from (feedback_id, user_id, emoji)
--              to (feedback_id, user_id). Selecting a new emoji now
--              replaces the user's prior reaction on the same comment.
-- ==========================================

-- Dedupe any pre-existing rows (keep the most recent per user+feedback)
DELETE FROM "feedback_reactions" a
USING "feedback_reactions" b
WHERE a.feedback_id = b.feedback_id
  AND a.user_id = b.user_id
  AND a.created_at < b.created_at;

DROP INDEX IF EXISTS "feedback_reactions_feedback_id_user_id_emoji_key";

CREATE UNIQUE INDEX IF NOT EXISTS "feedback_reactions_feedback_id_user_id_key"
  ON "feedback_reactions"("feedback_id", "user_id");
