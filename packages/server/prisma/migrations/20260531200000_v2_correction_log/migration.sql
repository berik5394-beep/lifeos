-- v2 Phase B3 — Cross-Session Learning (feedback loop): CorrectionLog
-- Spec: docs/superpowers/specs/2026-05-31-v2-phase-b3-cross-session-learning-design.md
-- All operations idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- / pg_constraint guard) so re-applying via prisma migrate deploy is safe.

CREATE TABLE IF NOT EXISTS "CorrectionLog" (
  "id"             TEXT PRIMARY KEY,
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
  "recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CorrectionLog_userId_fkey') THEN
    ALTER TABLE "CorrectionLog"
      ADD CONSTRAINT "CorrectionLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CorrectionLog_userId_recordedAt_idx"
  ON "CorrectionLog"("userId", "recordedAt");
