-- Add refusal fields to team_invitations to mirror the project invitation
-- refusal flow (refused_at + refusal_reason).
ALTER TABLE "team_invitations" ADD COLUMN "refused_at" TIMESTAMP(3);
ALTER TABLE "team_invitations" ADD COLUMN "refusal_reason" TEXT;
