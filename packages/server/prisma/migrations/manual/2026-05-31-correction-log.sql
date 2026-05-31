-- v2 Phase B3 — CorrectionLog table (feedback-loop audit).
-- Idempotent: safe to re-run. Matches B1/B2 manual-migration pattern.

CREATE TABLE IF NOT EXISTS "CorrectionLog" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "userMsgId"      TEXT,
  "botExcerpt"     TEXT NOT NULL,
  "userExcerpt"    TEXT NOT NULL,
  "signalType"     TEXT NOT NULL,
  "valence"        TEXT NOT NULL,
  "dimension"      TEXT NOT NULL,
  "appliedSignals" JSONB NOT NULL,
  "styleNote"      TEXT,
  "moodDelta"      DOUBLE PRECISION,
  "reaskSim"       DOUBLE PRECISION,
  "recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorrectionLog_userId_recordedAt_idx"
  ON "CorrectionLog" ("userId", "recordedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CorrectionLog_userId_fkey'
  ) THEN
    ALTER TABLE "CorrectionLog"
      ADD CONSTRAINT "CorrectionLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
