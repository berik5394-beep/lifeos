-- Hermes follow-up — cache the skill's probe embedding to avoid re-embedding
-- every skill on every message in the router. Idempotent.
ALTER TABLE "SkillDefinition" ADD COLUMN IF NOT EXISTS "embedding" JSONB;
