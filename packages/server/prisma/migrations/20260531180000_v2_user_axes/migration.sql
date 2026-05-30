-- v2 Phase B1 — USER NEST Axes
-- Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
-- All operations idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
-- so re-applying via prisma db execute or migrate deploy is safe.

CREATE TABLE IF NOT EXISTS "UserAxes" (
  "id"                  TEXT PRIMARY KEY,
  "userId"              TEXT NOT NULL UNIQUE,
  "selfDiscipline"      DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "emotionalOpenness"   DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "conflictTolerance"   DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "introspectionDepth"  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "signalCount"         INTEGER NOT NULL DEFAULT 0,
  "lastSignalAt"        TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAxes_userId_fkey') THEN
    ALTER TABLE "UserAxes"
      ADD CONSTRAINT "UserAxes_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "UserAxes_userId_idx" ON "UserAxes"("userId");

CREATE TABLE IF NOT EXISTS "AxisSignal" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL,
  "msgId"        TEXT,
  "axis"         TEXT NOT NULL,
  "delta"        DOUBLE PRECISION NOT NULL,
  "confidence"   DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "excerpt"      TEXT,
  "source"       TEXT NOT NULL DEFAULT 'claude_classifier',
  "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AxisSignal_userId_fkey') THEN
    ALTER TABLE "AxisSignal"
      ADD CONSTRAINT "AxisSignal_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AxisSignal_userId_axis_recordedAt_idx"
  ON "AxisSignal"("userId", "axis", "recordedAt");
CREATE INDEX IF NOT EXISTS "AxisSignal_userId_recordedAt_idx"
  ON "AxisSignal"("userId", "recordedAt");
CREATE INDEX IF NOT EXISTS "AxisSignal_msgId_idx"
  ON "AxisSignal"("msgId");
