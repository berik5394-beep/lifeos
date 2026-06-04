-- Decision: журнал решений + ретро (кросс-домен мост #4). Идемпотентно
-- (IF NOT EXISTS) — таблица создаётся raw-SQL на проде, replay через
-- migrate deploy безопасен (no-op на проде, fresh на тест-БД).
CREATE TABLE IF NOT EXISTS "Decision" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "expectedOutcome" TEXT,
  "reviewDate"      DATE NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'open',
  "actualOutcome"   TEXT,
  "verdict"         TEXT,
  "decidedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"      TIMESTAMP(3),
  "source"          TEXT NOT NULL DEFAULT 'manual',
  CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Decision_userId_status_reviewDate_idx"
  ON "Decision" ("userId", "status", "reviewDate");

DO $$ BEGIN
  ALTER TABLE "Decision" ADD CONSTRAINT "Decision_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
