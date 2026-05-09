-- Allow FeedbackReaction rows to represent a guest reaction (user_id NULL,
-- guest_email + guest_name set) in addition to the existing authenticated
-- pattern (user_id set, guest_* NULL).
--
-- Postgres' default UNIQUE semantics treat NULLs as DISTINCT, so the
-- existing UNIQUE (feedback_id, user_id) keeps enforcing one reaction
-- per authenticated user without blocking multiple guest rows. Guest
-- uniqueness on (feedback_id, guest_email) is enforced application-side
-- in the controller (findFirst-then-act).

ALTER TABLE "feedback_reactions"
  ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "feedback_reactions"
  ADD COLUMN "guest_email" TEXT,
  ADD COLUMN "guest_name"  TEXT;

CREATE INDEX "feedback_reactions_feedback_id_guest_email_idx"
  ON "feedback_reactions" ("feedback_id", "guest_email");
