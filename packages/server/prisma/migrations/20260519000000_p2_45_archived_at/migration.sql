-- Phase 5 P2 4/5 — re-decompose foundation (W2/ISSUE-Z).
-- АДДИТИВНО (правило ISSUE-X: до cutover db push→migrate deploy
-- схема только аддитивна). IF NOT EXISTS — идемпотентно (прод
-- синкается через db push). Никаких DROP.
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
