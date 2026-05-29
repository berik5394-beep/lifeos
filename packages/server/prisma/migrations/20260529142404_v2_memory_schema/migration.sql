-- v2.0 Memory + Proactivity — Tier 2/3/4/5 schema foundation.
-- Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md
-- Pattern: idempotent (IF NOT EXISTS + DO $$ guards), как в
-- 20260528000000_memory_pgvector_idempotent/migration.sql.
-- В проде no-op если уже накатили частично. В чистой dev — создаст всё.

-- pgvector extension already created by 20260528000000_memory_pgvector_idempotent.
-- Re-assert IF NOT EXISTS for safety:
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================
-- 1. Memory table — add v2.0 extension columns (Tier 2 Episodic)
-- =============================================================

ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "validAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "invalidAt" TIMESTAMP(3);
-- NOT NULL matches Prisma schema (String[] without ? = non-nullable)
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "entityRefs" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "mood" DOUBLE PRECISION;

-- Backfill: existing rows get validAt = createdAt
UPDATE "Memory" SET "validAt" = "createdAt"
WHERE "validAt" = CURRENT_TIMESTAMP AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '1 second';

CREATE INDEX IF NOT EXISTS "Memory_userId_validAt_idx" ON "Memory"("userId", "validAt");
CREATE INDEX IF NOT EXISTS "Memory_userId_invalidAt_idx" ON "Memory"("userId", "invalidAt");
-- GIN на entityRefs (array contains query "WHERE entityRefs @> ARRAY['entity-X']")
-- Prisma 6 syntax не handle mixed-column GIN cleanly → raw SQL здесь.
-- Critical for getEventsForEntity / lastEventForEntity / entityFrequency.
CREATE INDEX IF NOT EXISTS "Memory_entityRefs_gin_idx" ON "Memory" USING GIN ("entityRefs");

-- =============================================================
-- 2. Entity table (Tier 3 Semantic)
-- =============================================================

CREATE TABLE IF NOT EXISTS "Entity" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "type"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    -- NOT NULL matches Prisma schema (String[] without ? = non-nullable)
    "aliases"      TEXT[] NOT NULL DEFAULT '{}',
    "attributes"   JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baselineFreq" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moodAvg"      DOUBLE PRECISION,
    "importance"   INTEGER NOT NULL DEFAULT 5,
    "embedding"    vector(512),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Entity_userId_fkey') THEN
        ALTER TABLE "Entity" ADD CONSTRAINT "Entity_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Entity_userId_type_name_key" ON "Entity"("userId", "type", "name");
CREATE INDEX IF NOT EXISTS "Entity_userId_type_idx" ON "Entity"("userId", "type");
CREATE INDEX IF NOT EXISTS "Entity_userId_lastSeenAt_idx" ON "Entity"("userId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "Entity_userId_importance_idx" ON "Entity"("userId", "importance");

-- =============================================================
-- 3. EntityRelationship table (Tier 3 Graph)
-- =============================================================

CREATE TABLE IF NOT EXISTS "EntityRelationship" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "fromId"    TEXT NOT NULL,
    "toId"      TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "label"     TEXT,
    "strength"  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "validAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityRelationship_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntityRelationship_userId_fkey') THEN
        ALTER TABLE "EntityRelationship" ADD CONSTRAINT "EntityRelationship_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntityRelationship_fromId_fkey') THEN
        ALTER TABLE "EntityRelationship" ADD CONSTRAINT "EntityRelationship_fromId_fkey"
            FOREIGN KEY ("fromId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntityRelationship_toId_fkey') THEN
        ALTER TABLE "EntityRelationship" ADD CONSTRAINT "EntityRelationship_toId_fkey"
            FOREIGN KEY ("toId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "EntityRelationship_userId_fromId_toId_type_validAt_key"
    ON "EntityRelationship"("userId", "fromId", "toId", "type", "validAt");
CREATE INDEX IF NOT EXISTS "EntityRelationship_userId_fromId_idx" ON "EntityRelationship"("userId", "fromId");
CREATE INDEX IF NOT EXISTS "EntityRelationship_userId_toId_idx" ON "EntityRelationship"("userId", "toId");

-- =============================================================
-- 4. Pattern table (Tier 4 Procedural mini)
-- =============================================================

CREATE TABLE IF NOT EXISTS "Pattern" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "kind"           TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "payload"        JSONB NOT NULL,
    "confidence"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observations"   INTEGER NOT NULL DEFAULT 1,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pattern_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Pattern_userId_fkey') THEN
        ALTER TABLE "Pattern" ADD CONSTRAINT "Pattern_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Pattern_userId_kind_idx" ON "Pattern"("userId", "kind");
CREATE INDEX IF NOT EXISTS "Pattern_userId_confidence_idx" ON "Pattern"("userId", "confidence");
CREATE INDEX IF NOT EXISTS "Pattern_userId_validAt_invalidAt_idx" ON "Pattern"("userId", "validAt", "invalidAt");

-- =============================================================
-- 5. MoodSnapshot table (Tier 5 Emotional)
-- =============================================================

CREATE TABLE IF NOT EXISTS "MoodSnapshot" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "source"     TEXT NOT NULL,
    "sourceId"   TEXT,
    "valence"    DOUBLE PRECISION NOT NULL,
    "arousal"    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "emotion"    TEXT NOT NULL,
    -- NOT NULL matches Prisma schema (String[] without ? = non-nullable)
    "entityRefs" TEXT[] NOT NULL DEFAULT '{}',
    "excerpt"    TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MoodSnapshot_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MoodSnapshot_userId_fkey') THEN
        ALTER TABLE "MoodSnapshot" ADD CONSTRAINT "MoodSnapshot_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MoodSnapshot_userId_recordedAt_idx" ON "MoodSnapshot"("userId", "recordedAt");
CREATE INDEX IF NOT EXISTS "MoodSnapshot_userId_emotion_idx" ON "MoodSnapshot"("userId", "emotion");
-- GIN на entityRefs (same reason as Memory above) — для queries
-- "find mood snapshots involving entity X".
CREATE INDEX IF NOT EXISTS "MoodSnapshot_entityRefs_gin_idx" ON "MoodSnapshot" USING GIN ("entityRefs");

-- =============================================================
-- 6. BotIdentity table (Tier 5 Identity mini)
-- =============================================================

CREATE TABLE IF NOT EXISTS "BotIdentity" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "botName"   TEXT NOT NULL DEFAULT 'Эля',
    "avatar"    TEXT NOT NULL DEFAULT '🤍',
    "style"     TEXT NOT NULL DEFAULT 'friendly',
    "traits"    JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotIdentity_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BotIdentity_userId_fkey') THEN
        ALTER TABLE "BotIdentity" ADD CONSTRAINT "BotIdentity_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BotIdentity_userId_key" ON "BotIdentity"("userId");
