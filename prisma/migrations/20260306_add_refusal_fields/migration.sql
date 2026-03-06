-- AlterTable
ALTER TABLE "project_invitations" ADD COLUMN "refused_at" TIMESTAMP(3),
ADD COLUMN "refusal_reason" TEXT;
