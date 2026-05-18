-- Phase 5 P2 — YearlyGoal pacing (Option E + custom). АДДИТИВНО
-- (правило ISSUE-X: до cutover db push→migrate deploy схема только
-- аддитивна, иначе db push без --accept-data-loss валит деплой).
-- IF NOT EXISTS — идемпотентно (прод синкается через db push).
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "target" DOUBLE PRECISION;
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "pacingMode" TEXT NOT NULL DEFAULT 'uniform';
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "pacingPlan" JSONB;
