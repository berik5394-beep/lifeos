-- Phase 5 R5 P4-fold — поля ЕДИНОГО dispatch-ядра на Insight.
-- АДДИТИВНО (правило ISSUE-X: до cutover db push→migrate deploy
-- схема только аддитивна). IF NOT EXISTS — идемпотентно. Без DROP.
-- kind/scopeKey — cooldown/supersede ключи (R9/R10);
-- source — провенанс кандидата (analytics/cost/debug/ML);
-- expiresAt — TTL (R9); supersededAt — погашен новым (R9).
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "scopeKey" TEXT;
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Insight" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Insight_userId_kind_scopeKey_idx" ON "Insight"("userId", "kind", "scopeKey");
