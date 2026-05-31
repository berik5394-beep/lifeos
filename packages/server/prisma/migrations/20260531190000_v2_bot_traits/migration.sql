-- v2 Phase B2 — Identity Evolution: BotTraitSnapshot table.
-- Idempotent (CREATE TABLE IF NOT EXISTS + DO $$ FK guard + CREATE INDEX
-- IF NOT EXISTS) — safe to re-apply.

CREATE TABLE IF NOT EXISTS "BotTraitSnapshot" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL,
  "warmth"       DOUBLE PRECISION NOT NULL,
  "directness"   DOUBLE PRECISION NOT NULL,
  "humor"        DOUBLE PRECISION NOT NULL,
  "playfulness"  DOUBLE PRECISION NOT NULL,
  "depth"        DOUBLE PRECISION NOT NULL,
  "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BotTraitSnapshot_userId_fkey') THEN
    ALTER TABLE "BotTraitSnapshot"
      ADD CONSTRAINT "BotTraitSnapshot_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BotTraitSnapshot_userId_recordedAt_idx"
  ON "BotTraitSnapshot"("userId", "recordedAt");
