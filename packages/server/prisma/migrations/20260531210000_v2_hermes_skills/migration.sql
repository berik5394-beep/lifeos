-- v2 Phase B4 — Hermes composable skills: SkillDefinition
-- Standard prisma migration folder (applied by Dockerfile `migrate deploy`).
-- Idempotent (IF NOT EXISTS + pg_constraint guard) — safe to re-run.

CREATE TABLE IF NOT EXISTS "SkillDefinition" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "triggers"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "plan"        JSONB NOT NULL,
  "synthesis"   TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "useCount"    INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SkillDefinition_userId_fkey') THEN
    ALTER TABLE "SkillDefinition"
      ADD CONSTRAINT "SkillDefinition_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SkillDefinition_userId_name_key"
  ON "SkillDefinition"("userId", "name");
CREATE INDEX IF NOT EXISTS "SkillDefinition_userId_active_idx"
  ON "SkillDefinition"("userId", "active");
