-- Коуч по накоплениям: срок финансовой цели.
-- Аддитивная nullable-колонка. IF NOT EXISTS → идемпотентно (как прежние
-- v2-миграции); на прод применяется через `prisma migrate deploy`.
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "targetDate" TIMESTAMP(3);
