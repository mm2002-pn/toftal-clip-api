-- ==========================================
-- Migration: Add Feedback Reactions (WhatsApp/Linear-style emoji)
-- Date: 2026-04-21
-- ==========================================

CREATE TABLE IF NOT EXISTS "feedback_reactions" (
  "id" TEXT NOT NULL,
  "feedback_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_reactions_pkey" PRIMARY KEY ("id")
);

-- Prevent the same user reacting twice with the same emoji on the same feedback
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_reactions_feedback_id_user_id_emoji_key"
  ON "feedback_reactions"("feedback_id", "user_id", "emoji");

CREATE INDEX IF NOT EXISTS "feedback_reactions_feedback_id_idx"
  ON "feedback_reactions"("feedback_id");

CREATE INDEX IF NOT EXISTS "feedback_reactions_user_id_idx"
  ON "feedback_reactions"("user_id");

ALTER TABLE "feedback_reactions"
  ADD CONSTRAINT "feedback_reactions_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "feedbacks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feedback_reactions"
  ADD CONSTRAINT "feedback_reactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
