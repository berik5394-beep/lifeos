-- MonthlyGoal: «цель на месяц» из чата (зеркало WeeklyGoal). ИДЕМПОТЕНТНА:
-- CREATE TABLE/INDEX IF NOT EXISTS + FK через DO/pg_constraint → no-op на проде,
-- полная на чистой БД. .env=ПРОД, накатывает Railway migrate deploy на деплое.
CREATE TABLE IF NOT EXISTS "MonthlyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthStart" DATE NOT NULL,
    "goalText" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MonthlyGoal_userId_monthStart_idx" ON "MonthlyGoal"("userId", "monthStart");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MonthlyGoal_userId_fkey') THEN
  ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
