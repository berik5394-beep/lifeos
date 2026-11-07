-- MoodSnapshot."updatedAt" без DB-default в проде (таблица существовала до
-- CREATE TABLE IF NOT EXISTS) → сырые INSERT падали с 23502. Идемпотентно.
ALTER TABLE "MoodSnapshot" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
