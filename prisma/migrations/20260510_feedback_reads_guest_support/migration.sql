-- Allow FeedbackRead rows to represent a guest read receipt (user_id NULL,
-- guest_email set) in addition to the existing authenticated pattern
-- (user_id set, guest_email NULL).
--
-- Same dual-identity strategy as feedback_reactions: Postgres' default
-- UNIQUE semantics treat NULLs as DISTINCT, so the existing
-- UNIQUE (feedback_id, user_id) keeps enforcing one read per
-- authenticated user without blocking multiple guest rows. Guest
-- uniqueness on (feedback_id, guest_email) is enforced application-side.

ALTER TABLE "feedback_reads"
  ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "feedback_reads"
  ADD COLUMN "guest_email" TEXT;

CREATE INDEX "feedback_reads_feedback_id_guest_email_idx"
  ON "feedback_reads" ("feedback_id", "guest_email");
