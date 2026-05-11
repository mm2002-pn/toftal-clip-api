-- CreateEnum
CREATE TYPE "DownscaleJobStatus" AS ENUM ('PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "version_downscale_jobs" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "status" "DownscaleJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "cloud_run_execution_id" TEXT,
    "result_url" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "version_downscale_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (used by the zombie sweeper to scan stuck PROCESSING rows)
CREATE INDEX "version_downscale_jobs_status_started_at_idx" ON "version_downscale_jobs"("status", "started_at");

-- CreateIndex (enforces dedup — only one job per (version, quality))
CREATE UNIQUE INDEX "version_downscale_jobs_version_id_quality_key" ON "version_downscale_jobs"("version_id", "quality");

-- AddForeignKey
ALTER TABLE "version_downscale_jobs" ADD CONSTRAINT "version_downscale_jobs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
