-- Коуч: дата постановки цели (копим ОТ неё, не с 1 января).
-- Аддитивно; существующие строки получают момент миграции (приемлемо).
ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
