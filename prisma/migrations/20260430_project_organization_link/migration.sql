-- Add nullable organisation FK on projects so a project can live either in
-- a personal space (NULL) or in a team space (= the org id).
ALTER TABLE "projects" ADD COLUMN "organization_id" TEXT;

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");

-- AddForeignKey — onDelete SetNull keeps the project alive if the team is
-- deleted (it just falls back to a personal project).
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
