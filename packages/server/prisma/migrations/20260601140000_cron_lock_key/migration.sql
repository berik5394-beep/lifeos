-- 2.1 (AUDIT-2026-06): атомарный claim-ключ для withCronLock.
-- Идемпотентно. unique(lockKey) → конкурентные тики/инстансы гонят на
-- insert, выигрывает один (остальные ловят P2002 и пропускают).
ALTER TABLE "CronJobRun" ADD COLUMN IF NOT EXISTS "lockKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CronJobRun_lockKey_key" ON "CronJobRun"("lockKey");
