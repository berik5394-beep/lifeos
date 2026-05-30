-- v2.0 Week 6 — CronJobRun audit table for cron idempotency.
-- Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
-- Pattern: idempotent (IF NOT EXISTS + DO $$ guards), как в
-- 20260529142404_v2_memory_schema/migration.sql.
-- В проде no-op если уже накатили. В чистой dev — создаёт всё.

CREATE TABLE IF NOT EXISTS "CronJobRun" (
    "id"      TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "userId"  TEXT,
    "ranAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CronJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronJobRun_jobName_ranAt_idx"
    ON "CronJobRun"("jobName", "ranAt");

CREATE INDEX IF NOT EXISTS "CronJobRun_userId_jobName_ranAt_idx"
    ON "CronJobRun"("userId", "jobName", "ranAt");
