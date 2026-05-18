-- Phase 5 P1 — планировочная иерархия + Insight (рефлектор).
-- Только схема, без кода поведения. Прод синкается через
-- `prisma db push` (колонки/таблица появятся оттуда); этот файл —
-- гигиена истории для будущего `prisma migrate deploy`. IF [NOT]
-- EXISTS → идемпотентно независимо от того, что уже применил push.

-- AlterTable: planner-дерево (дискриминатор, БЕЗ DB-FK — parent
-- может быть в другой таблице, у Prisma нет полиморфного FK).
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "planParentId" TEXT;
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "planParentType" TEXT;
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "derivedFrom" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "planParentId" TEXT;
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "planParentType" TEXT;
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "derivedFrom" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "planParentId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "planParentType" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "derivedFrom" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "planParentId" TEXT;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "planParentType" TEXT;
ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "derivedFrom" TEXT NOT NULL DEFAULT 'user';

-- CreateIndex: planParentId на каждой сущности (обход дерева вниз).
CREATE INDEX IF NOT EXISTS "YearlyGoal_planParentId_idx" ON "YearlyGoal"("planParentId");
CREATE INDEX IF NOT EXISTS "WeeklyGoal_planParentId_idx" ON "WeeklyGoal"("planParentId");
CREATE INDEX IF NOT EXISTS "Task_planParentId_idx" ON "Task"("planParentId");
CREATE INDEX IF NOT EXISTS "Habit_planParentId_idx" ON "Habit"("planParentId");

-- CreateTable: Insight (рефлектор — что мозг подсветил + фидбек).
CREATE TABLE IF NOT EXISTS "Insight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" INTEGER NOT NULL,
    "scope" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "rationale" TEXT,
    "suggestedAction" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "userFeedback" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Insight_userId_createdAt_idx" ON "Insight"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Insight_userId_deliveredAt_severity_idx" ON "Insight"("userId", "deliveredAt", "severity");

-- FK: инсайты юзера уходят с юзером (Cascade) — это не аудит-лог.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Insight_userId_fkey'
  ) THEN
    ALTER TABLE "Insight"
      ADD CONSTRAINT "Insight_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
