# v2.0 Week 2: Schema + Tier 1 Working + Tier 2 Episodic Implementation Plan (v2 — careful rewrite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NB:** Это v2 плана — переписан после self-review v1 (нашёл 20+ ошибок).
> Главные fix'ы: убран `vi.mock` (его НЕТ в проекте), migration через
> existing IF NOT EXISTS pattern, pure helpers + thin prisma wrappers как
> в `memory-service.ts`, bounded queue в WorkingMemory, fix `invalidAt`
> type contract, реальные local DB setup instructions.

**Goal:** Заложить foundation v2.0 Memory layer: Prisma schema + 5 new tables (idempotent migration) + Tier 1 (Working) + Tier 2 (Episodic). Без интеграции в orchestrator (Week 5).

**Architecture:** Pure helpers separately from prisma wrappers (mirror `memory-service.ts` pattern). Idempotent migration following existing `20260528000000_memory_pgvector_idempotent` pattern. No DB-touching tests — следуем project convention (pure unit + structural).

**Tech Stack:** TypeScript ES2022 + module=ESNext + moduleResolution=bundler, Prisma 6, Postgres + pgvector (extension уже создан в проде via prev migration), Vitest 3.x, Node 20+.

**Verified project patterns (Phase 1 investigation):**
- `npm test` = `vitest run`
- `npm run db:migrate` = `prisma migrate dev`
- `npm run db:generate` = `prisma generate`
- Test files: pure helpers OR structural grep (`readFileSync` + content match). **НЕТ `vi.mock` нигде в проекте** — не использовать в plan.
- Existing services pattern: pure exports + async prisma exports в одном файле (`memory-service.ts` строки 8-21 pure + 22+ async).
- Existing migrations pattern: raw SQL с `IF NOT EXISTS` + `DO $$ BEGIN ... END $$` для FK guards. Idempotent. Reference: `prisma/migrations/20260528000000_memory_pgvector_idempotent/migration.sql`.

**Scope этого плана (Week 2):**
- Schema migration: Memory extensions + 5 new tables
- WorkingMemory service — bounded in-process Map с rotation
- EpisodicMemory service — pure helpers + async wrappers
- Feature flag skeleton (для Week 5)

**НЕ в этом плане (отложено):**
- Entity graph queries (Week 3)
- Pattern extractors (Week 4)
- Mood analysis (Week 4)
- Proactivity Engine (Week 5)
- Integration в `jarvis-orchestrator.ts` (Week 5)
- Migration существующих 67 rows в Entity/EntityRelationship (Week 6)
- Feature flag rollout в env (Week 7)

**Prereq:** spec `docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md` approved.

---

## File Structure

**Create:**
- `packages/server/prisma/migrations/YYYYMMDDHHMMSS_v2_memory_schema/migration.sql` — timestamp picks at Task A3
- `packages/server/src/services/working-memory.ts`
- `packages/server/src/services/working-memory.test.ts`
- `packages/server/src/services/episodic-memory.ts`
- `packages/server/src/services/episodic-memory.test.ts`
- `packages/server/src/lib/feature-flags.ts`
- `packages/server/src/lib/feature-flags.test.ts`

**Modify:**
- `packages/server/prisma/schema.prisma` — add Memory fields + 5 new models + reverse relations on User

**Note on test file location:** проект использует `*.test.ts` рядом с `*.ts` (не `__tests__/` подпапка). Проверено: `src/services/memory-service.test.ts`, `src/services/env-key-discipline.test.ts`. Следуем этой convention.

---

## Section A — Schema + Migration (4 tasks)

### Task A1: Extend Prisma schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Read current schema** to know exact location of `model Memory`

```bash
cd packages/server
grep -n "^model " prisma/schema.prisma
```

Expected: list of all models with line numbers. Note line of `model Memory {`.

- [ ] **Step 2: Add 4 fields + 2 indexes to existing Memory model**

In `prisma/schema.prisma`, find `model Memory {` block. Insert these 4 lines BEFORE the existing `@@index` lines:

```prisma
  // v2.0 — Episodic extension (validity windows + entity refs + mood)
  validAt     DateTime                    @default(now())
  invalidAt   DateTime?
  entityRefs  String[]                    @default([])
  mood        Float?
```

Add these 2 new `@@index` lines AFTER existing `@@index` block (do NOT remove existing indexes):

```prisma
  @@index([userId, validAt])
  @@index([userId, invalidAt])
```

NB: We do NOT add a GIN index for `entityRefs` here. Reason: Prisma 6
syntax `@@index([..., entityRefs], type: Gin)` may not work cleanly for
mixed-column GIN. We'll add it via raw SQL in Task A3 if needed.

- [ ] **Step 3: Add Entity model at end of schema.prisma**

Append to file:

```prisma
// v2.0 — Tier 3 Semantic + Entity Graph
model Entity {
  id            String                      @id @default(cuid())
  userId        String
  user          User                        @relation(fields: [userId], references: [id], onDelete: Cascade)
  type          String                      // 'person' | 'place' | 'concept' | 'goal' | 'organization'
  name          String
  aliases       String[]                    @default([])
  attributes    Json                        @default("{}")
  lastSeenAt    DateTime                    @default(now())
  baselineFreq  Float                       @default(0)
  moodAvg       Float?
  importance    Int                         @default(5)
  embedding     Unsupported("vector(512)")?
  createdAt     DateTime                    @default(now())
  updatedAt     DateTime                    @updatedAt

  relsFrom      EntityRelationship[]        @relation("FromEntity")
  relsTo        EntityRelationship[]        @relation("ToEntity")

  @@unique([userId, type, name])
  @@index([userId, type])
  @@index([userId, lastSeenAt])
  @@index([userId, importance])
}
```

- [ ] **Step 4: Add EntityRelationship model**

Append:

```prisma
model EntityRelationship {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  fromId      String
  from        Entity    @relation("FromEntity", fields: [fromId], references: [id], onDelete: Cascade)
  toId        String
  to          Entity    @relation("ToEntity", fields: [toId], references: [id], onDelete: Cascade)
  type        String    // 'family'|'friend'|'colleague'|'partner'|'concern'|'goal_link'|'location'|'works_at'|'lives_in'|'connected_to'
  label       String?
  strength    Float     @default(0.5)
  validAt     DateTime  @default(now())
  invalidAt   DateTime?
  createdAt   DateTime  @default(now())
  // Fix 2026-05-28 (code-review): strength evolves over time (relationships
  // strengthen/weaken). updatedAt даёт audit trail когда strength changed.
  updatedAt   DateTime  @updatedAt

  @@unique([userId, fromId, toId, type, validAt])
  @@index([userId, fromId])
  @@index([userId, toId])
}
```

- [ ] **Step 5: Add Pattern model**

Append:

```prisma
// v2.0 — Tier 4 Procedural mini
model Pattern {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind           String    // 'frequency'|'time_of_day'|'recurring_topic'|'commitment'|'streak_break'
  description    String
  payload        Json
  confidence     Float     @default(0)
  observations   Int       @default(1)
  lastObservedAt DateTime  @default(now())
  validAt        DateTime  @default(now())
  invalidAt      DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([userId, kind])
  @@index([userId, confidence])
  @@index([userId, validAt, invalidAt])
}
```

- [ ] **Step 6: Add MoodSnapshot model**

Append:

```prisma
// v2.0 — Tier 5 Emotional
model MoodSnapshot {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  source      String    // 'message'|'daily_agg'
  sourceId    String?
  valence     Float
  arousal     Float     @default(0.5)
  emotion     String    // 'sad'|'anxious'|'happy'|'angry'|'neutral'|'mixed'
  entityRefs  String[]  @default([])
  excerpt     String?
  recordedAt  DateTime  @default(now())
  // Fix 2026-05-28 (code-review): daily_agg rows будут recomputed (cron
  // weekly aggregation). updatedAt = audit trail когда снимок пересчитан.
  updatedAt   DateTime  @updatedAt

  @@index([userId, recordedAt])
  @@index([userId, emotion])
}
```

- [ ] **Step 7: Add BotIdentity model**

Append:

```prisma
// v2.0 — Tier 5 Identity mini
model BotIdentity {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  botName   String   @default("Эля")
  avatar    String   @default("🤍")
  style     String   @default("friendly")
  traits    Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 8: Add reverse relations to existing User model**

Find `model User {`. Insert BEFORE closing `}`:

```prisma
  // v2.0 — Tier 3+4+5 reverse relations
  entities          Entity[]
  entityRelations   EntityRelationship[]
  patterns          Pattern[]
  moodSnapshots     MoodSnapshot[]
  botIdentity       BotIdentity?
```

- [ ] **Step 9: Format schema (catches syntax errors early)**

```bash
cd packages/server
npx prisma format
```

Expected: schema rewritten with consistent spacing, no errors. If errors → re-read Steps 1-8 and fix typos.

### Task A2: Verify schema valid + types generate

**Files:** none (verification only)

- [ ] **Step 1: Generate Prisma client**

```bash
cd packages/server
npm run db:generate
```

Expected output (last lines):
```
✔ Generated Prisma Client (vX.Y.Z) to ./node_modules/@prisma/client in Xms
```

If error like "validation error" → schema invalid, fix in Task A1.

- [ ] **Step 2: TypeScript check — verify new types exist**

Create temp file `packages/server/tmp-types-check.ts`:

```typescript
import type { Memory, Entity, EntityRelationship, Pattern, MoodSnapshot, BotIdentity } from '@prisma/client';

// Compile-time type checks — does NOT run, just compiles
function _check() {
  const m: Memory['validAt'] = new Date();
  const e: Entity['baselineFreq'] = 0;
  const r: EntityRelationship['strength'] = 0.5;
  const p: Pattern['confidence'] = 0;
  const ms: MoodSnapshot['valence'] = 0;
  const i: BotIdentity['botName'] = 'Эля';
  // Optional fields
  const ia: Memory['invalidAt'] = null;
  return { m, e, r, p, ms, i, ia };
}
console.log('Types check compiled OK');
```

Run TypeScript check:
```bash
npx tsc --noEmit tmp-types-check.ts 2>&1 | head -10
```

Expected: clean output (no errors). If errors → Prisma generate didn't pick up new models.

Then run executable check:
```bash
npx tsx tmp-types-check.ts
```

Expected: prints "Types check compiled OK".

Clean up:
```bash
rm tmp-types-check.ts
```

- [ ] **Step 3: Full project tsc (no regression in existing code)**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: clean exit. If errors in non-schema files → schema change broke something, investigate.

### Task A3: Create idempotent migration file

**Files:**
- Create: `packages/server/prisma/migrations/<TIMESTAMP>_v2_memory_schema/migration.sql`

Following existing pattern from `20260528000000_memory_pgvector_idempotent/migration.sql` — idempotent (IF NOT EXISTS + DO $$ guards). No `prisma migrate dev` needed (we hand-write to match existing convention).

- [ ] **Step 1: Generate timestamp + create directory**

```bash
cd packages/server
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p prisma/migrations/${TS}_v2_memory_schema
echo "Created directory: prisma/migrations/${TS}_v2_memory_schema"
```

Note the printed timestamp for Step 2.

- [ ] **Step 2: Write migration.sql**

Create `prisma/migrations/<TIMESTAMP>_v2_memory_schema/migration.sql` (use timestamp from Step 1):

```sql
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
```

- [ ] **Step 3: Verify migration syntax (without applying)**

```bash
cd packages/server
# Just check file is readable + no obvious typos via grep
grep -c "CREATE TABLE IF NOT EXISTS" prisma/migrations/*_v2_memory_schema/migration.sql
```

Expected: `5` (Entity, EntityRelationship, Pattern, MoodSnapshot, BotIdentity).

```bash
grep -c "DO \$\$" prisma/migrations/*_v2_memory_schema/migration.sql
```

Expected: `5` (one FK guard block per table).

### Task A4: Apply migration to local DB

**Files:** none (DB changes only)

**Local Postgres setup (if not already running):**

If you don't have local Postgres or pgvector — use docker compose. Create `packages/server/docker-compose.dev.yml` if not exists:

```yaml
version: '3'
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: lifeos_dev
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
volumes:
  pg_data:
```

Start it: `docker compose -f docker-compose.dev.yml up -d`

Set local env in shell:
```bash
export DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev'
```

If you DO have local Postgres without pgvector: install via OS package manager (e.g. macOS: `brew install pgvector`). Verify: `psql -c 'CREATE EXTENSION IF NOT EXISTS vector;'`.

- [ ] **Step 1: Apply migration**

```bash
cd packages/server
npm run db:migrate
```

When prompted for migration name (Prisma sees pending migration in folder): just press Enter — it will use the folder name.

Expected last lines:
```
Applying migration `<TIMESTAMP>_v2_memory_schema`
The following migration(s) have been applied:
... <TIMESTAMP>_v2_memory_schema/
... migration.sql
Your database is now in sync with your schema.
```

If error like "drift detected" → the schema already has changes not matching migrations. Run:
```bash
npx prisma migrate resolve --applied <TIMESTAMP>_v2_memory_schema
```
And apply manually:
```bash
psql $DATABASE_URL -f prisma/migrations/<TIMESTAMP>_v2_memory_schema/migration.sql
```

- [ ] **Step 2: Verify tables created**

```bash
psql $DATABASE_URL -c "\dt" | grep -E 'Entity|Pattern|MoodSnapshot|BotIdentity'
```

Expected (4 lines):
```
 public | BotIdentity        | table | ...
 public | Entity             | table | ...
 public | EntityRelationship | table | ...
 public | MoodSnapshot       | table | ...
 public | Pattern            | table | ...
```

- [ ] **Step 3: Verify Memory has new columns**

```bash
psql $DATABASE_URL -c '\d "Memory"' | grep -E 'validAt|invalidAt|entityRefs|mood'
```

Expected: 4 matching lines for validAt, invalidAt, entityRefs, mood.

- [ ] **Step 4: Verify idempotency — re-running migration is no-op**

```bash
psql $DATABASE_URL -f prisma/migrations/*_v2_memory_schema/migration.sql 2>&1 | tail -10
```

Expected: only NOTICE messages about existing constraints; no errors.

- [ ] **Step 5: Commit Tasks A1-A4**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/*_v2_memory_schema/
git commit -m "feat(v2-memory): Prisma schema + idempotent migration for Tier 2/3/4/5 tables

- Memory: +validAt/+invalidAt/+entityRefs/+mood (Tier 2 episodic extension)
- Entity (Tier 3 semantic with vector(512) embedding)
- EntityRelationship (Tier 3 graph with valid_at/invalid_at)
- Pattern (Tier 4 procedural mini)
- MoodSnapshot (Tier 5 emotional)
- BotIdentity (Tier 5 identity mini)

Migration follows existing IF NOT EXISTS + DO \$\$ pattern from
20260528000000_memory_pgvector_idempotent. Idempotent — re-runs safe.

Services in next tasks (B+C+D)."
```

---

## Section B — WorkingMemory Service (3 tasks)

Pure in-memory service. No prisma, no async. Fully unit-testable per
existing `memory-service.test.ts` pattern.

### Task B1: WorkingMemory class with bounded queue + eviction

**Files:**
- Create: `packages/server/src/services/working-memory.ts`
- Create: `packages/server/src/services/working-memory.test.ts`

- [ ] **Step 1: Write failing tests (TDD)**

Create `packages/server/src/services/working-memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WorkingMemory } from './working-memory.js';

describe('WorkingMemory — addTurn + getContext', () => {
  it('adds new turn to user context', () => {
    const wm = new WorkingMemory();
    const ts = new Date();
    wm.addTurn('user1', { role: 'user', content: 'hello', ts });
    const ctx = wm.getContext('user1');
    expect(ctx).not.toBeNull();
    expect(ctx?.lastMessages).toHaveLength(1);
    expect(ctx?.lastMessages[0].content).toBe('hello');
    expect(ctx?.lastMessages[0].role).toBe('user');
  });

  it('appends multiple turns in order', () => {
    const wm = new WorkingMemory();
    wm.addTurn('user1', { role: 'user', content: 'a', ts: new Date(1) });
    wm.addTurn('user1', { role: 'assistant', content: 'b', ts: new Date(2) });
    wm.addTurn('user1', { role: 'user', content: 'c', ts: new Date(3) });
    const ctx = wm.getContext('user1');
    expect(ctx?.lastMessages.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('isolates contexts per userId', () => {
    const wm = new WorkingMemory();
    wm.addTurn('u1', { role: 'user', content: 'A', ts: new Date() });
    wm.addTurn('u2', { role: 'user', content: 'B', ts: new Date() });
    expect(wm.getContext('u1')?.lastMessages[0].content).toBe('A');
    expect(wm.getContext('u2')?.lastMessages[0].content).toBe('B');
  });

  it('returns null for unknown user', () => {
    const wm = new WorkingMemory();
    expect(wm.getContext('nonexistent')).toBeNull();
  });

  it('updates lastActivityAt on each addTurn', () => {
    const wm = new WorkingMemory();
    const t1 = new Date(100);
    const t2 = new Date(200);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: t1 });
    expect(wm.getContext('u1')?.lastActivityAt).toEqual(t1);
    wm.addTurn('u1', { role: 'user', content: 'y', ts: t2 });
    expect(wm.getContext('u1')?.lastActivityAt).toEqual(t2);
  });
});

describe('WorkingMemory — bounded queue (anti memory-leak)', () => {
  it('keeps only last N msgs (default 50)', () => {
    const wm = new WorkingMemory();
    for (let i = 0; i < 60; i++) {
      wm.addTurn('u1', { role: 'user', content: `msg${i}`, ts: new Date(i) });
    }
    const ctx = wm.getContext('u1');
    expect(ctx?.lastMessages).toHaveLength(50);
    // Should keep most recent 50 (msg10..msg59)
    expect(ctx?.lastMessages[0].content).toBe('msg10');
    expect(ctx?.lastMessages[49].content).toBe('msg59');
  });

  it('respects custom maxMessages option', () => {
    const wm = new WorkingMemory({ maxMessages: 5 });
    for (let i = 0; i < 10; i++) {
      wm.addTurn('u1', { role: 'user', content: `${i}`, ts: new Date(i) });
    }
    const ctx = wm.getContext('u1');
    expect(ctx?.lastMessages).toHaveLength(5);
    expect(ctx?.lastMessages.map((m) => m.content)).toEqual(['5', '6', '7', '8', '9']);
  });
});

describe('WorkingMemory — evictIdle', () => {
  it('evicts contexts idle > threshold (default 1 hour)', () => {
    const wm = new WorkingMemory();
    const now = new Date();
    const oldTs = new Date(now.getTime() - 90 * 60 * 1000); // 90 min ago
    wm.addTurn('idle', { role: 'user', content: 'old', ts: oldTs });
    wm.addTurn('active', { role: 'user', content: 'new', ts: now });

    const evicted = wm.evictIdle(now);

    expect(evicted).toBe(1);
    expect(wm.getContext('idle')).toBeNull();
    expect(wm.getContext('active')).not.toBeNull();
  });

  it('respects custom idleThresholdMs', () => {
    const wm = new WorkingMemory({ idleThresholdMs: 5_000 });
    const now = new Date();
    const oldTs = new Date(now.getTime() - 10_000);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: oldTs });
    wm.evictIdle(now);
    expect(wm.getContext('u1')).toBeNull();
  });

  it('returns 0 when nothing to evict', () => {
    const wm = new WorkingMemory();
    expect(wm.evictIdle()).toBe(0);
    wm.addTurn('u1', { role: 'user', content: 'fresh', ts: new Date() });
    expect(wm.evictIdle()).toBe(0);
  });
});

describe('WorkingMemory — size', () => {
  it('reports active context count', () => {
    const wm = new WorkingMemory();
    expect(wm.size()).toBe(0);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: new Date() });
    expect(wm.size()).toBe(1);
    wm.addTurn('u2', { role: 'user', content: 'y', ts: new Date() });
    expect(wm.size()).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — expect ALL to fail**

```bash
cd packages/server
npx vitest run src/services/working-memory.test.ts
```

Expected: FAIL with "Failed to resolve import" (module not found).

- [ ] **Step 3: Implement WorkingMemory**

Create `packages/server/src/services/working-memory.ts`:

```typescript
/**
 * v2.0 Tier 1 — Working Memory.
 *
 * In-process краткосрочный контекст текущего разговора. Last N msgs
 * (bounded queue — anti memory-leak) + fresh entities + active mood.
 * Используется для context enrichment в каждом jarvis response (Week 5).
 *
 * Lifespan: минуты-часы → idle eviction → консолидируется в Episodic
 * (delegate to Week 5 integration).
 *
 * Pure in-memory, no prisma. Fully unit-testable.
 */

export type WorkingTurn = {
  role: 'user' | 'assistant';
  content: string;
  ts: Date;
};

export type WorkingContext = {
  userId: string;
  lastMessages: WorkingTurn[];
  freshEntities: Set<string>; // entity ids mentioned in last hour
  currentMood: number;         // -1..+1, decay over time (Week 4 wires this)
  lastActivityAt: Date;
};

export type WorkingMemoryOptions = {
  /** Max msgs retained per user (bounded queue). Default 50. */
  maxMessages?: number;
  /** Idle threshold ms — older → evicted. Default 1 hour. */
  idleThresholdMs?: number;
};

export class WorkingMemory {
  private contexts = new Map<string, WorkingContext>();
  private readonly maxMessages: number;
  private readonly idleThresholdMs: number;

  constructor(opts: WorkingMemoryOptions = {}) {
    this.maxMessages = opts.maxMessages ?? 50;
    this.idleThresholdMs = opts.idleThresholdMs ?? 60 * 60 * 1000;
  }

  /**
   * Add new turn to user's working context. O(1) amortized.
   * Creates context if not exists. Trims oldest if exceeds maxMessages.
   */
  addTurn(userId: string, msg: WorkingTurn): void {
    let ctx = this.contexts.get(userId);
    if (!ctx) {
      ctx = {
        userId,
        lastMessages: [],
        freshEntities: new Set(),
        currentMood: 0,
        lastActivityAt: msg.ts,
      };
      this.contexts.set(userId, ctx);
    }
    ctx.lastMessages.push(msg);
    // Bounded queue — drop oldest if exceeds limit
    if (ctx.lastMessages.length > this.maxMessages) {
      ctx.lastMessages.splice(0, ctx.lastMessages.length - this.maxMessages);
    }
    ctx.lastActivityAt = msg.ts;
  }

  /**
   * Get current context snapshot. O(1).
   * Returns null if no context exists.
   */
  getContext(userId: string): WorkingContext | null {
    return this.contexts.get(userId) ?? null;
  }

  /**
   * Evict contexts idle longer than idleThresholdMs.
   * Called periodically (Week 5 — every 5 min from scheduler).
   * Returns number of evicted.
   */
  evictIdle(now: Date = new Date()): number {
    const cutoff = now.getTime() - this.idleThresholdMs;
    let evicted = 0;
    for (const [userId, ctx] of this.contexts) {
      if (ctx.lastActivityAt.getTime() < cutoff) {
        this.contexts.delete(userId);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Active context count — for introspection / metrics.
   */
  size(): number {
    return this.contexts.size;
  }
}
```

- [ ] **Step 4: Run tests — expect ALL to pass (11 tests)**

```bash
npx vitest run src/services/working-memory.test.ts
```

Expected: `Test Files 1 passed (1)`, `Tests 11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add packages/server/src/services/working-memory.ts packages/server/src/services/working-memory.test.ts
git commit -m "feat(v2-memory): WorkingMemory class — bounded queue + eviction (Tier 1)

- addTurn / getContext / evictIdle / size
- Bounded queue (default 50 msgs) — anti memory-leak
- Configurable via constructor (maxMessages, idleThresholdMs)
- Pure in-memory, no prisma, fully unit-testable
- 11 tests passing

Wired into orchestrator in Week 5 (separate plan)."
```

### Task B2: WorkingMemory singleton accessor + tests

**Files:**
- Modify: `packages/server/src/services/working-memory.ts`
- Modify: `packages/server/src/services/working-memory.test.ts`

- [ ] **Step 1: Add failing tests for singleton**

Append to `working-memory.test.ts`:

```typescript
import { getWorkingMemory, _resetWorkingMemoryForTests } from './working-memory.js';

describe('WorkingMemory — singleton accessor', () => {
  it('returns same instance on subsequent calls', () => {
    _resetWorkingMemoryForTests();
    const a = getWorkingMemory();
    const b = getWorkingMemory();
    expect(a).toBe(b);
  });

  it('persists state across calls', () => {
    _resetWorkingMemoryForTests();
    const a = getWorkingMemory();
    a.addTurn('u1', { role: 'user', content: 'x', ts: new Date() });
    const b = getWorkingMemory();
    expect(b.getContext('u1')).not.toBeNull();
  });

  it('_resetWorkingMemoryForTests creates fresh instance', () => {
    const a = getWorkingMemory();
    a.addTurn('u1', { role: 'user', content: 'x', ts: new Date() });
    _resetWorkingMemoryForTests();
    const b = getWorkingMemory();
    expect(b.getContext('u1')).toBeNull();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests — singleton tests fail**

```bash
npx vitest run src/services/working-memory.test.ts
```

Expected: 3 failures (others still pass).

- [ ] **Step 3: Add singleton accessor**

Append to `working-memory.ts`:

```typescript
/**
 * Global singleton instance — created lazily.
 * Wired into jarvis-orchestrator in Week 5 (separate plan).
 */
let _instance: WorkingMemory | null = null;

export function getWorkingMemory(): WorkingMemory {
  if (!_instance) {
    _instance = new WorkingMemory();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files / cases.
 * Underscore prefix signals "internal API".
 */
export function _resetWorkingMemoryForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run tests — all pass (14 total)**

```bash
npx vitest run src/services/working-memory.test.ts
```

Expected: `Tests 14 passed (14)`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/working-memory.ts packages/server/src/services/working-memory.test.ts
git commit -m "feat(v2-memory): WorkingMemory singleton accessor + reset helper"
```

### Task B3: Full server test suite verify

**Files:** none

- [ ] **Step 1: Run full server tests**

```bash
cd packages/server
npm test 2>&1 | tail -10
```

Expected: all tests pass. Note the count — should be (baseline 846) + 14 (working-memory) = ~860. Real baseline check:

```bash
git stash
npm test 2>&1 | grep "Tests" | tail -1
git stash pop
```

Expected baseline output e.g. `Tests  846 passed (846)`. After our changes, expect baseline + 14.

- [ ] **Step 2: TypeScript check on full project**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean (no errors).

If any failure → debug before continuing to Section C.

---

## Section C — EpisodicMemory Service (5 tasks)

Pure helpers (testable) + thin async prisma wrappers (testable via
structural tests like `memory-service.test.ts`). Mirror pattern.

### Task C1: Pure helpers (validate + clamp) + unit tests

**Files:**
- Create: `packages/server/src/services/episodic-memory.ts`
- Create: `packages/server/src/services/episodic-memory.test.ts`

- [ ] **Step 1: Write failing tests for pure helpers**

Create `packages/server/src/services/episodic-memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateEventInput, clampMood } from './episodic-memory.js';

describe('clampMood — emotional valence -1..+1', () => {
  it('returns undefined for undefined input', () => {
    expect(clampMood(undefined)).toBeUndefined();
  });

  it('clamps below -1 to -1', () => {
    expect(clampMood(-5)).toBe(-1);
    expect(clampMood(-1.0001)).toBe(-1);
  });

  it('clamps above +1 to +1', () => {
    expect(clampMood(5)).toBe(1);
    expect(clampMood(1.0001)).toBe(1);
  });

  it('passes through values in [-1, +1]', () => {
    expect(clampMood(0)).toBe(0);
    expect(clampMood(-0.5)).toBe(-0.5);
    expect(clampMood(0.7)).toBe(0.7);
    expect(clampMood(-1)).toBe(-1);
    expect(clampMood(1)).toBe(1);
  });
});

describe('validateEventInput', () => {
  it('passes valid input', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'звонил маме',
        validAt: new Date('2026-05-28'),
      }),
    ).not.toThrow();
  });

  it('throws if content empty', () => {
    expect(() => validateEventInput({ type: 'event', content: '' })).toThrow(/content/);
    expect(() => validateEventInput({ type: 'event', content: '   ' })).toThrow(/content/);
  });

  it('throws if type empty', () => {
    expect(() => validateEventInput({ type: '', content: 'x' })).toThrow(/type/);
  });

  it('throws if invalidAt before validAt', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'x',
        validAt: new Date('2026-06-01'),
        invalidAt: new Date('2026-05-01'),
      }),
    ).toThrow(/validAt.*invalidAt/);
  });

  it('throws if importance out of [1, 10]', () => {
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 0 }),
    ).toThrow(/importance/);
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 11 }),
    ).toThrow(/importance/);
  });

  it('passes importance in range', () => {
    for (let i = 1; i <= 10; i++) {
      expect(() =>
        validateEventInput({ type: 'event', content: 'x', importance: i }),
      ).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests — fail (module not found)**

```bash
cd packages/server
npx vitest run src/services/episodic-memory.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement pure helpers**

Create `packages/server/src/services/episodic-memory.ts`:

```typescript
import { prisma } from '../lib/prisma.js';
import type { Memory } from '@prisma/client';

/**
 * v2.0 Tier 2 — Episodic Memory.
 *
 * События во времени с validity windows (Graphiti pattern):
 * - validAt: когда event случился (default now)
 * - invalidAt: когда event стал недействителен (null = действующий)
 *
 * Builds on Memory table + Tier 2 extension fields (validAt/invalidAt/
 * entityRefs/mood — added in Task A1).
 *
 * Architecture: pure helpers (validateEventInput, clampMood) separately
 * from async prisma wrappers — следует existing pattern из
 * memory-service.ts (shouldOverwriteContent / computeExpiresAt pure +
 * captureMemory / getRelevantMemories async).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordEventInput = {
  type: string;
  content: string;
  details?: string;
  entityRefs?: string[];
  /** -1..+1 emotional valence; clamped silently if out of range */
  mood?: number;
  /** When event occurred; default now() */
  validAt?: Date;
  /** Optional explicit invalidation timestamp (e.g. event already cancelled when recorded). */
  invalidAt?: Date;
  /** 1-10; default 5 */
  importance?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Clamp mood value to [-1, +1] range. Undefined → undefined (no override).
 */
export function clampMood(mood: number | undefined): number | undefined {
  if (mood === undefined) return undefined;
  return Math.max(-1, Math.min(1, mood));
}

/**
 * Validate RecordEventInput. Throws Error with message if invalid.
 * Returns nothing on success.
 *
 * Rules:
 * - content must be non-empty (trimmed)
 * - type must be non-empty
 * - invalidAt (if provided) must be >= validAt
 * - importance (if provided) must be in [1, 10]
 */
export function validateEventInput(input: RecordEventInput): void {
  if (!input.type || input.type.trim().length === 0) {
    throw new Error('validateEventInput: type must be non-empty');
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new Error('validateEventInput: content must be non-empty');
  }
  if (input.invalidAt && input.validAt && input.invalidAt < input.validAt) {
    throw new Error(
      `validateEventInput: invalidAt (${input.invalidAt.toISOString()}) cannot be before validAt (${input.validAt.toISOString()})`,
    );
  }
  if (input.importance !== undefined) {
    if (input.importance < 1 || input.importance > 10) {
      throw new Error(`validateEventInput: importance must be in [1, 10], got ${input.importance}`);
    }
  }
}
```

- [ ] **Step 4: Run tests — expect all to pass (12 tests)**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: `Tests 12 passed (12)`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/episodic-memory.ts packages/server/src/services/episodic-memory.test.ts
git commit -m "feat(v2-memory): EpisodicMemory pure helpers — clampMood + validateEventInput

Pattern: pure helpers separately from async prisma wrappers, как в
memory-service.ts (shouldOverwriteContent/computeExpiresAt → pure;
captureMemory → async). Pure helpers fully unit-tested (12 tests);
async wrappers covered structurally in next tasks."
```

### Task C2: recordEvent async wrapper + structural test

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts`
- Modify: `packages/server/src/services/episodic-memory.test.ts`

- [ ] **Step 1: Add structural test (asserts source uses helpers)**

Append to `episodic-memory.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/episodic-memory.ts'),
  'utf-8',
);

describe('episodic-memory.ts structural — recordEvent wiring', () => {
  it('recordEvent exported as async function', () => {
    expect(SRC).toMatch(/export async function recordEvent\s*\(/);
  });

  it('recordEvent calls validateEventInput before prisma write', () => {
    // Find recordEvent body
    const start = SRC.indexOf('export async function recordEvent');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    // Order: validateEventInput appears before prisma.memory.create
    const validateIdx = body.indexOf('validateEventInput(');
    const createIdx = body.indexOf('prisma.memory.create');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(createIdx);
  });

  it('recordEvent applies clampMood', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('clampMood(');
  });

  it('recordEvent sets source = "v2-episodic"', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/source:\s*['"]v2-episodic['"]/);
  });
});
```

- [ ] **Step 2: Run tests — 4 new fail (recordEvent not yet)**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: 4 new failures, 12 prior pass.

- [ ] **Step 3: Implement recordEvent**

Append to `episodic-memory.ts`:

```typescript
// ---------------------------------------------------------------------------
// Async API (thin prisma wrappers — structural tests in *.test.ts)
// ---------------------------------------------------------------------------

/**
 * Record new episodic event.
 *
 * Validates input via validateEventInput (throws if invalid).
 * Clamps mood to [-1, +1] silently.
 *
 * @returns Created Memory row id.
 */
export async function recordEvent(
  userId: string,
  input: RecordEventInput,
): Promise<{ id: string }> {
  validateEventInput(input);
  const validAt = input.validAt ?? new Date();
  const mood = clampMood(input.mood);

  const created = await prisma.memory.create({
    data: {
      userId,
      type: input.type,
      content: input.content.slice(0, 500),
      details: input.details?.slice(0, 2000) ?? null,
      source: 'v2-episodic',
      sourceId: null,
      tags: [],
      importance: input.importance ?? 5,
      validAt,
      invalidAt: input.invalidAt ?? null,
      entityRefs: input.entityRefs ?? [],
      mood: mood ?? null,
    },
    select: { id: true },
  });

  return { id: created.id };
}
```

- [ ] **Step 4: Run tests — all pass (16 total)**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: `Tests 16 passed (16)`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/episodic-memory.ts packages/server/src/services/episodic-memory.test.ts
git commit -m "feat(v2-memory): EpisodicMemory.recordEvent with validation + mood clamp"
```

### Task C3: invalidateEvent async + structural test

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts`
- Modify: `packages/server/src/services/episodic-memory.test.ts`

- [ ] **Step 1: Add structural test**

Append to `episodic-memory.test.ts`:

```typescript
describe('episodic-memory.ts structural — invalidateEvent wiring', () => {
  it('invalidateEvent exported as async function', () => {
    expect(SRC).toMatch(/export async function invalidateEvent\s*\(/);
  });

  it('invalidateEvent calls prisma.memory.update with invalidAt', () => {
    const start = SRC.indexOf('export async function invalidateEvent');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.update');
    expect(body).toContain('invalidAt');
  });

  it('invalidateEvent defaults invalidAt to new Date()', () => {
    const start = SRC.indexOf('export async function invalidateEvent');
    const body = SRC.slice(start, start + 800);
    // Parameter signature contains default
    expect(body).toMatch(/invalidAt\s*:\s*Date\s*=\s*new Date\(\)/);
  });
});
```

- [ ] **Step 2: Run tests — 3 new fail**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: 3 failures, 16 prior pass.

- [ ] **Step 3: Implement invalidateEvent**

Append to `episodic-memory.ts`:

```typescript
/**
 * Mark event as invalid (e.g. «передумал увольняться»).
 * Default invalidAt = now().
 */
export async function invalidateEvent(
  eventId: string,
  invalidAt: Date = new Date(),
): Promise<void> {
  await prisma.memory.update({
    where: { id: eventId },
    data: { invalidAt },
  });
}
```

- [ ] **Step 4: Run tests — pass (19 total)**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: `Tests 19 passed (19)`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(v2-memory): EpisodicMemory.invalidateEvent"
```

### Task C4: Query methods (3 async functions) + structural tests

**Files:**
- Modify: `packages/server/src/services/episodic-memory.ts`
- Modify: `packages/server/src/services/episodic-memory.test.ts`

- [ ] **Step 1: Add structural tests for all 3 query methods**

Append to `episodic-memory.test.ts`:

```typescript
describe('episodic-memory.ts structural — query methods wiring', () => {
  it('getEventsForEntity exported as async function', () => {
    expect(SRC).toMatch(/export async function getEventsForEntity\s*\(/);
  });

  it('getEventsForEntity filters by entityRefs has', () => {
    const start = SRC.indexOf('export async function getEventsForEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('entityRefs:');
    expect(body).toContain('has:');
  });

  it('getEventsForEntity excludes invalidated by default', () => {
    const start = SRC.indexOf('export async function getEventsForEntity');
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt:');
    expect(body).toContain('null');
    expect(body).toContain('includeInvalid');
  });

  it('lastEventForEntity exported + uses findFirst orderBy validAt desc', () => {
    expect(SRC).toMatch(/export async function lastEventForEntity\s*\(/);
    const start = SRC.indexOf('export async function lastEventForEntity');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.findFirst');
    expect(body).toMatch(/orderBy:\s*\{\s*validAt:\s*['"]desc['"]/);
  });

  it('entityFrequency exported + uses count with date filter', () => {
    expect(SRC).toMatch(/export async function entityFrequency\s*\(/);
    const start = SRC.indexOf('export async function entityFrequency');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.count');
    expect(body).toContain('validAt:');
    expect(body).toContain('gte:');
  });

  it('entityFrequency excludes invalidated', () => {
    const start = SRC.indexOf('export async function entityFrequency');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('invalidAt:');
    expect(body).toContain('null');
  });
});
```

- [ ] **Step 2: Run tests — 6 new fail**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: 6 failures.

- [ ] **Step 3: Implement all 3 query methods**

Append to `episodic-memory.ts`:

```typescript
/**
 * Get events that reference a specific entity.
 * By default excludes invalidated events (invalidAt != null).
 */
export async function getEventsForEntity(
  userId: string,
  entityId: string,
  opts: {
    includeInvalid?: boolean;
    limit?: number;
  } = {},
): Promise<Memory[]> {
  return prisma.memory.findMany({
    where: {
      userId,
      entityRefs: { has: entityId },
      ...(opts.includeInvalid ? {} : { invalidAt: null }),
    },
    orderBy: { validAt: 'desc' },
    take: opts.limit ?? 50,
  });
}

/**
 * Most recent event referencing this entity (or null if none).
 * Excludes invalidated events.
 */
export async function lastEventForEntity(
  userId: string,
  entityId: string,
): Promise<Memory | null> {
  return prisma.memory.findFirst({
    where: {
      userId,
      entityRefs: { has: entityId },
      invalidAt: null,
    },
    orderBy: { validAt: 'desc' },
  });
}

/**
 * Number of (non-invalidated) events for entity in last N days.
 */
export async function entityFrequency(
  userId: string,
  entityId: string,
  periodDays: number,
): Promise<number> {
  const since = new Date(Date.now() - periodDays * 86_400_000);
  return prisma.memory.count({
    where: {
      userId,
      entityRefs: { has: entityId },
      invalidAt: null,
      validAt: { gte: since },
    },
  });
}
```

- [ ] **Step 4: Run tests — pass (25 total)**

```bash
npx vitest run src/services/episodic-memory.test.ts
```

Expected: `Tests 25 passed (25)`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(v2-memory): EpisodicMemory query methods — getEventsForEntity / lastEventForEntity / entityFrequency"
```

### Task C5: EpisodicMemory full verify + tsc

**Files:** none

- [ ] **Step 1: Full server tests**

```bash
cd packages/server
npm test 2>&1 | tail -10
```

Expected: baseline 846 + 14 (working) + 25 (episodic) = ~885. All pass.

- [ ] **Step 2: tsc no-emit**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

If failures → debug before Section D.

---

## Section D — Feature flags + wrap-up (2 tasks)

### Task D1: feature-flags.ts + tests

**Files:**
- Create: `packages/server/src/lib/feature-flags.ts`
- Create: `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/lib/feature-flags.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { isV2MemoryEnabled, isV2ProactivityEnabled } from './feature-flags.js';

const ORIG_MEM = process.env.FEATURE_V2_MEMORY;
const ORIG_PROAC = process.env.FEATURE_V2_PROACTIVITY;

afterEach(() => {
  if (ORIG_MEM === undefined) delete process.env.FEATURE_V2_MEMORY;
  else process.env.FEATURE_V2_MEMORY = ORIG_MEM;
  if (ORIG_PROAC === undefined) delete process.env.FEATURE_V2_PROACTIVITY;
  else process.env.FEATURE_V2_PROACTIVITY = ORIG_PROAC;
});

describe('isV2MemoryEnabled', () => {
  it('returns false when env unset', () => {
    delete process.env.FEATURE_V2_MEMORY;
    expect(isV2MemoryEnabled('user1')).toBe(false);
  });

  it.each(['', 'none', 'false'])('returns false when env = %s', (v) => {
    process.env.FEATURE_V2_MEMORY = v;
    expect(isV2MemoryEnabled('user1')).toBe(false);
  });

  it('returns true for all users when env = "all"', () => {
    process.env.FEATURE_V2_MEMORY = 'all';
    expect(isV2MemoryEnabled('user1')).toBe(true);
    expect(isV2MemoryEnabled('user-zzz')).toBe(true);
  });

  it('returns true only for listed userIds (comma-separated)', () => {
    process.env.FEATURE_V2_MEMORY = 'user-berikId,user-aydanaId';
    expect(isV2MemoryEnabled('berikId')).toBe(true);
    expect(isV2MemoryEnabled('aydanaId')).toBe(true);
    expect(isV2MemoryEnabled('otherId')).toBe(false);
  });

  it('handles whitespace around entries', () => {
    process.env.FEATURE_V2_MEMORY = ' user-a , user-b ';
    expect(isV2MemoryEnabled('a')).toBe(true);
    expect(isV2MemoryEnabled('b')).toBe(true);
  });

  it('ignores trailing/leading whitespace in flag itself', () => {
    process.env.FEATURE_V2_MEMORY = '  all  ';
    expect(isV2MemoryEnabled('x')).toBe(true);
  });
});

describe('isV2ProactivityEnabled', () => {
  it('uses separate FEATURE_V2_PROACTIVITY env', () => {
    delete process.env.FEATURE_V2_PROACTIVITY;
    process.env.FEATURE_V2_MEMORY = 'all';  // memory ON but proactivity not
    expect(isV2ProactivityEnabled('user1')).toBe(false);
  });

  it('returns true when env = "all"', () => {
    process.env.FEATURE_V2_PROACTIVITY = 'all';
    expect(isV2ProactivityEnabled('user1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — fail (module missing)**

```bash
cd packages/server
npx vitest run src/lib/feature-flags.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/server/src/lib/feature-flags.ts`:

```typescript
/**
 * v2.0 Feature flags — controls gradual rollout per-user.
 *
 * Used by jarvis-orchestrator in Week 5 to dual-write v2 memory only
 * for opted-in users. Old captureMemory continues for everyone.
 *
 * Env value formats (same for both flags):
 *   "all"                          — enabled for everyone
 *   "" | "none" | "false" | unset  — disabled
 *   "user-{id1},user-{id2}"        — only listed userIds
 *
 * Whitespace around entries and around the whole value is ignored.
 */

function isEnabledForUser(envValue: string | undefined, userId: string): boolean {
  const flag = (envValue ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  if (flag === 'all') return true;
  return flag
    .split(',')
    .map((s) => s.trim())
    .some((s) => s === `user-${userId}`);
}

export function isV2MemoryEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEMORY, userId);
}

export function isV2ProactivityEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_PROACTIVITY, userId);
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run src/lib/feature-flags.test.ts
```

Expected: all tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -m "feat(v2-flags): isV2MemoryEnabled + isV2ProactivityEnabled with whitespace tolerance

Pure helpers — no side effects. Wired into orchestrator + proactivity
in Week 5/Week 7 (separate plans)."
```

### Task D2: Final verify + progress tracker update

**Files:**
- Modify: `docs/plan/v2-memory-proactivity-scope.md`
- Modify: `~/.claude/projects/-Users-berikkurmangoliev-Desktop-LifeOS/memory/v2_memory_proactivity_scope.md`

- [ ] **Step 1: Final full server test run**

```bash
cd packages/server
npm test 2>&1 | tail -10
```

Expected: baseline 846 + 14 working + 25 episodic + ~9 flags ≈ 894 total. All pass.

If unexpected failures: investigate before commit.

- [ ] **Step 2: tsc no-emit clean**

```bash
npx tsc --noEmit 2>&1 | tail -3
```

Expected: zero errors.

- [ ] **Step 3: Update progress tracker in scope lock**

Edit `docs/plan/v2-memory-proactivity-scope.md`. Find the Progress tracker table. Update Week 2 rows:

```markdown
| 2 | Prisma schema migration | ✅ done | YYYY-MM-DD | migration <TIMESTAMP>_v2_memory_schema (5 new tables + Memory extensions, idempotent) |
| 2 | Tier 1+2 implementation | ✅ done | YYYY-MM-DD | working-memory.ts (14 tests) + episodic-memory.ts (25 tests) + feature-flags.ts (~9 tests) |
```

(Replace YYYY-MM-DD with actual date, replace `<TIMESTAMP>` with actual.)

- [ ] **Step 4: Update cross-session memory**

Edit `~/.claude/projects/-Users-berikkurmangoliev-Desktop-LifeOS/memory/v2_memory_proactivity_scope.md`. Update the «Текущий статус» section:

```markdown
## Текущий статус

- ✅ Scope lock Путь 2 (2026-05-28)
- ✅ Design spec (2026-05-28)
- ✅ Implementation plan Week 2 v2 careful rewrite (2026-05-28)
- ✅ Week 2 DONE: schema migration + Tier 1 Working + Tier 2 Episodic + feature flags
  - 5 new tables, idempotent migration
  - WorkingMemory: bounded queue + eviction + singleton (14 tests)
  - EpisodicMemory: pure helpers + 4 async wrappers, structural tests (25 tests)
  - feature-flags.ts skeleton (~9 tests)
- ⏳ Next: Plan 2 для Week 3 (Tier 3 Entity Graph + extractor)
```

- [ ] **Step 5: Final commit (Week 2 done)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git add docs/plan/v2-memory-proactivity-scope.md
git commit -m "docs(v2-progress): Week 2 DONE — schema + Tier 1 Working + Tier 2 Episodic + flags

Implemented:
- Idempotent migration <TIMESTAMP>_v2_memory_schema (5 new tables + Memory extensions)
- WorkingMemory (bounded queue + eviction + singleton, 14 tests)
- EpisodicMemory (pure helpers validateEventInput/clampMood + 4 async wrappers, 25 tests)
- feature-flags.ts (isV2MemoryEnabled + isV2ProactivityEnabled, 9 tests)
- Total new tests: ~48 (baseline 846 → expected ~894)

Pattern: pure helpers + structural tests for async wrappers (mirror
memory-service.ts), zero vi.mock (project has no precedent).

Next: Plan 2 for Week 3 — Tier 3 Entity Graph + EntityExtractor.

Per work protocol: checkpoint complete, awaiting Berik approval to write Plan 2."
```

- [ ] **Step 6: Report to Berik**

Notify: «Week 2 DONE. ~48 new tests passing (~894 total). All commits local, не pushed. Ready to write Plan 2 for Week 3 — awaiting твоё "иди" before starting.»

---

## Self-Review (after writing plan — for the plan author, not the engineer)

**1. Spec coverage:**
- ✅ Memory extensions (validAt/invalidAt/entityRefs/mood) — Task A1
- ✅ 5 new tables migration — Tasks A1-A4
- ✅ Tier 1 Working Memory с bounded queue — Tasks B1-B3
- ✅ Tier 2 Episodic Memory (recordEvent, invalidateEvent, 3 queries) — Tasks C1-C5
- ✅ Feature flags skeleton — Task D1
- ✅ Final verify + tracker update — Task D2

**Gaps:** none for Week 2 scope. Tier 3/4/5/Proactivity correctly in next plans.

**2. Placeholder scan (after writing):**
- ✅ No "TBD", "TODO", "implement later"
- ✅ All TypeScript code blocks complete (no `// ...`)
- ✅ All SQL migration blocks complete
- ✅ Exact commands with expected output

**3. Type consistency:**
- ✅ `WorkingTurn` / `WorkingContext` / `WorkingMemoryOptions` defined once, used consistently
- ✅ `RecordEventInput` defined once
- ✅ Method names: `addTurn` / `getContext` / `evictIdle` / `size` consistent
- ✅ Prisma field names match between schema (Task A1) and service code (Tasks B+C)
- ✅ `getEventsForEntity` parameter `opts` consistently structured

**4. Test pattern follows project convention:**
- ✅ Tests in `*.test.ts` alongside `*.ts` (not `__tests__/` subdir)
- ✅ Pure helpers fully unit-tested (clampMood, validateEventInput, WorkingMemory class)
- ✅ Async prisma wrappers covered by structural tests (readFileSync grep), mirror memory-service.ts pattern
- ✅ ZERO `vi.mock` usage — matches project (verified Phase 1)

**5. Migration follows project convention:**
- ✅ Raw SQL with IF NOT EXISTS + DO $$ guards (matches 20260528000000_memory_pgvector_idempotent)
- ✅ Idempotent — re-running is safe
- ✅ pgvector extension re-asserted (already exists from prev migration)

**6. Memory leak protection:**
- ✅ WorkingMemory has bounded queue (maxMessages default 50)
- ✅ Eviction policy (idleThresholdMs default 1h)

**7. Type contract correctness:**
- ✅ `RecordEventInput` includes `invalidAt` field properly (no `as any` cast in plan)
- ✅ `invalidateEvent` is separate method (clean separation)

**8. Commands realistic for project:**
- ✅ `npm test` (matches package.json)
- ✅ `npm run db:migrate` / `npm run db:generate` (matches package.json)
- ✅ Local Postgres setup via docker compose with pgvector image — engineer-ready

**9. Frequent commits:**
- ✅ Commit after each task (~13-15 commits in Plan 1 total)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-28-v2-week2-schema-tier1-tier2-v2.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks, fast iteration.
- 14 tasks = 14 fresh subagent contexts (no pollution)
- Each task ~5 steps TDD pattern — clean handoff
- Review between tasks catches issues early
- Estimated: 5-7 hours subagent work + ~30 min my review

**2. Inline Execution** — execute in this session using executing-plans, batch with checkpoints every 3-4 tasks.
- Same time, single session
- Live visibility of every step
- Context grows — may need checkpoint mid-way

**My recommendation: Subagent-Driven.** Cleaner separation, easier to recover if any task fails.
