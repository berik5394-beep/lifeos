# v2.0 Week 3: Tier 3 Entity Graph + EntityExtractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Tier 3 Entity Graph — a Postgres-backed graph store for canonical entity management + a Claude-based EntityExtractor that pulls entities and relationships from free text.

**Architecture:** `PostgresEntityGraph` implements the `EntityGraphStore` interface using Prisma ORM for standard queries and `$queryRawUnsafe` for the recursive CTE neighbor traversal (depth-capped at 5). Entity resolution is tiered: FTS exact name match → FTS alias match → pgvector cosine similarity fallback. The `EntityExtractor` mirrors the `extractFromTranscript` pattern in `dictation-service.ts`: single Claude JSON-only call, best-effort (failure → empty arrays, never throws). Nothing is wired to `jarvis-orchestrator` yet — Week 5 scope.

**Tech Stack:** TypeScript ES2022 + module=ESNext + moduleResolution=bundler (`.js` extensions in all imports), Prisma 6 + Postgres + pgvector (already in prod via Week 2 migration), Voyage AI embeddings (`embedDocument` from `services/embeddings.js`, best-effort), Anthropic Claude (`MODELS.haiku` for extraction), Vitest 3.x. Zero `vi.mock` — tests are pure unit (helpers) + structural (`readFileSync` grep).

---

## File Structure

**Create:**
- `packages/server/src/services/entity-graph/types.ts` — `EntityGraphStore` interface + re-exported types
- `packages/server/src/services/entity-graph/postgres-impl.ts` — `PostgresEntityGraph` class
- `packages/server/src/services/entity-graph/postgres-impl.test.ts` — structural tests + pure helper unit tests
- `packages/server/src/services/entity-graph/index.ts` — singleton accessor + re-exports
- `packages/server/src/services/entity-extractor.ts` — Claude-based extraction service
- `packages/server/src/services/entity-extractor.test.ts` — structural tests + pure helper unit tests

**Modify:** None in Week 3 (no wiring to orchestrator).

---

## Section A — Interface (1 task)

### Task A1: Create `entity-graph/types.ts` with interface and type re-exports

**Files:**
- Create: `packages/server/src/services/entity-graph/types.ts`
- Test: `packages/server/src/services/entity-graph/postgres-impl.test.ts` (structural section added in B1)


- [ ] **Step 1: Create the directory and the types file**

```bash
cd packages/server
mkdir -p src/services/entity-graph
```

Create `packages/server/src/services/entity-graph/types.ts`:

```typescript
/**
 * v2.0 Tier 3 — Entity Graph interface + type re-exports.
 *
 * EntityGraphStore abstracts the storage backend (Postgres default;
 * Neo4j possible future swap) so consumers (jarvis-orchestrator, Week 5)
 * bind to the interface, not to PostgresEntityGraph directly.
 *
 * Types Entity + EntityRelationship come from @prisma/client (generated
 * from the schema added in Week 2).
 */

import type { Entity, EntityRelationship } from '@prisma/client';

// Re-export Prisma types so consumers can import from one place.
export type { Entity, EntityRelationship };

export interface EntityGraphStore {
  /**
   * Resolve a canonical Entity from a raw mention string (e.g. "маме",
   * "Серик", "работа"). Strategy:
   *   1. FTS exact name match (plainto_tsquery russian, name column)
   *   2. FTS alias match (aliases array, unnested)
   *   3. pgvector cosine similarity fallback (if Voyage available)
   *
   * Returns null if nothing matches above threshold.
   * Returns the BEST single match (caller handles ambiguity via context).
   *
   * If type provided, restricts search to that entity type.
   */
  resolveEntity(userId: string, mention: string, type?: string): Promise<Entity | null>;

  /**
   * Create or upsert entity. Uses @@unique([userId, type, name]) to
   * detect existing. If exists: merges aliases (union), updates
   * lastSeenAt, merges attributes. Stores embedding best-effort.
   *
   * Returns the canonical (created or updated) Entity row.
   */
  upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
  ): Promise<Entity>;

  /**
   * Get entity by primary key. Returns null if not found.
   */
  getEntity(id: string): Promise<Entity | null>;

  /**
   * Create or update EntityRelationship. Idempotent on triple
   * (fromId, toId, type, validAt=now-day). If identical triple already
   * exists: UPDATE strength (MAX), return existing row. Never duplicates.
   *
   * opts.strength defaults to 0.5 if omitted.
   */
  linkEntities(
    userId: string,
    fromId: string,
    toId: string,
    type: string,
    opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship>;

  /**
   * Traverse entity graph outward from entityId up to `depth` hops
   * (hard-capped at 5 to prevent runaway). Uses Postgres recursive CTE.
   * Bidirectional: follows both from→to and to→from edges.
   * Excludes invalidated relationships (invalidAt IS NULL).
   *
   * Returns deduplicated neighbors ordered by distance ASC,
   * importance DESC within each distance tier.
   */
  getNeighbors(
    entityId: string,
    depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>>;

  /**
   * Find entities the user hasn't mentioned in the last `sinceDays` days
   * (lastSeenAt < now - sinceDays). Optional minImportance filter.
   * Returns ordered by importance DESC.
   */
  staleEntities(userId: string, sinceDays: number, minImportance?: number): Promise<Entity[]>;
}
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors (file is pure types/interface, no runtime code).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/entity-graph/types.ts
git commit -m "feat(v2-entity): EntityGraphStore interface + type re-exports (Tier 3 A1)"
```

---

## Section B — PostgresEntityGraph implementation (6 tasks)

### Task B1: Skeleton class + `upsertEntity` with best-effort embedding

**Files:**
- Create: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Create: `packages/server/src/services/entity-graph/postgres-impl.test.ts`


- [ ] **Step 1: Write the failing structural test**

Create `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'),
  'utf-8',
);

describe('postgres-impl.ts structural — skeleton + upsertEntity', () => {
  it('exports PostgresEntityGraph class', () => {
    expect(SRC).toMatch(/export class PostgresEntityGraph/);
  });

  it('implements EntityGraphStore interface', () => {
    expect(SRC).toMatch(/implements EntityGraphStore/);
  });

  it('upsertEntity exported as async method', () => {
    expect(SRC).toMatch(/async upsertEntity\s*\(/);
  });

  it('upsertEntity uses prisma.entity.upsert or create+update', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    const hasUpsert = body.includes('prisma.entity.upsert');
    const hasCreate = body.includes('prisma.entity.create');
    expect(hasUpsert || hasCreate).toBe(true);
  });

  it('upsertEntity stores embedding best-effort (calls storeEntityEmbedding or embedDocument)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    const hasEmbed = body.includes('storeEntityEmbedding') || body.includes('embedDocument');
    expect(hasEmbed).toBe(true);
  });

  it('upsertEntity merges aliases (union dedup)', () => {
    const start = SRC.indexOf('async upsertEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('aliases');
  });

  it('storeEntityEmbedding is a best-effort function (try/catch, no throw)', () => {
    expect(SRC).toMatch(/storeEntityEmbedding/);
    const start = SRC.indexOf('storeEntityEmbedding');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory ... postgres-impl.ts`

- [ ] **Step 3: Create `postgres-impl.ts` skeleton with `upsertEntity`**

Create `packages/server/src/services/entity-graph/postgres-impl.ts`:

```typescript
/**
 * v2.0 Tier 3 — PostgresEntityGraph: default implementation of EntityGraphStore.
 *
 * Uses Prisma ORM for all standard queries. Uses $queryRawUnsafe only for
 * the recursive CTE in getNeighbors (Prisma cannot express recursive CTEs).
 *
 * Embedding storage is best-effort: if Voyage is unavailable, entity is
 * saved without embedding — FTS still works for resolution.
 *
 * Pattern mirrors memory-service.ts:
 *  - storeEntityEmbedding: private best-effort async (like storeEmbedding)
 *  - resolveEntity: tiered FTS then embedding (like getRelevantMemories hybrid)
 */

import { prisma } from '../../lib/prisma.js';
import {
  embedDocument,
  embeddingsEnabled,
  toVectorLiteral,
} from '../embeddings.js';
import type { Entity, EntityRelationship } from '@prisma/client';
import type { EntityGraphStore } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Store entity embedding best-effort.
 * Does not throw — mirrors storeEmbedding in memory-service.ts.
 */
async function storeEntityEmbedding(id: string, name: string, aliases: string[]): Promise<void> {
  if (!embeddingsEnabled()) return;
  try {
    const text = aliases.length > 0 ? `${name} ${aliases.join(' ')}` : name;
    const vec = await embedDocument(text);
    if (!vec) return;
    await prisma.$executeRawUnsafe(
      'UPDATE "Entity" SET embedding = $1::vector WHERE id = $2',
      toVectorLiteral(vec),
      id,
    );
  } catch (err) {
    console.warn('[entity-graph] embed store failed:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// PostgresEntityGraph
// ---------------------------------------------------------------------------

export class PostgresEntityGraph implements EntityGraphStore {
  // -------------------------------------------------------------------------
  // upsertEntity
  // -------------------------------------------------------------------------

  async upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
  ): Promise<Entity> {
    const name = entity.name.trim().slice(0, 255);
    const type = entity.type.trim().slice(0, 64);
    const incomingAliases: string[] = (entity.aliases as string[] | undefined) ?? [];
    const attributes = (entity.attributes as Record<string, unknown> | undefined) ?? {};
    const importance = entity.importance ?? 5;

    // Try to find existing by unique index (userId, type, name).
    const existing = await prisma.entity.findUnique({
      where: { userId_type_name: { userId, type, name } },
    });

    if (existing) {
      // Merge aliases: union, deduplicate, preserve order (existing first).
      const mergedAliases = Array.from(
        new Set([...(existing.aliases as string[]), ...incomingAliases]),
      );
      // Merge attributes: spread existing, override with incoming.
      const mergedAttributes = {
        ...(existing.attributes as Record<string, unknown>),
        ...attributes,
      };

      const updated = await prisma.entity.update({
        where: { id: existing.id },
        data: {
          aliases: mergedAliases,
          attributes: mergedAttributes,
          importance: Math.max(existing.importance, importance),
          lastSeenAt: new Date(),
        },
      });

      // Best-effort: update embedding with merged alias set.
      await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
      return updated;
    }

    // Create new entity.
    const created = await prisma.entity.create({
      data: {
        userId,
        type,
        name,
        aliases: incomingAliases,
        attributes,
        importance,
        lastSeenAt: new Date(),
      },
    });

    await storeEntityEmbedding(created.id, created.name, created.aliases as string[]);
    return created;
  }

  // -------------------------------------------------------------------------
  // getEntity — placeholder; implemented in B2
  // -------------------------------------------------------------------------
  async getEntity(_id: string): Promise<Entity | null> {
    throw new Error('getEntity not yet implemented — Task B2');
  }

  // -------------------------------------------------------------------------
  // resolveEntity — placeholder; implemented in B3
  // -------------------------------------------------------------------------
  async resolveEntity(_userId: string, _mention: string, _type?: string): Promise<Entity | null> {
    throw new Error('resolveEntity not yet implemented — Task B3');
  }

  // -------------------------------------------------------------------------
  // linkEntities — placeholder; implemented in B4
  // -------------------------------------------------------------------------
  async linkEntities(
    _userId: string,
    _fromId: string,
    _toId: string,
    _type: string,
    _opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship> {
    throw new Error('linkEntities not yet implemented — Task B4');
  }

  // -------------------------------------------------------------------------
  // getNeighbors — placeholder; implemented in B5
  // -------------------------------------------------------------------------
  async getNeighbors(
    _entityId: string,
    _depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>> {
    throw new Error('getNeighbors not yet implemented — Task B5');
  }

  // -------------------------------------------------------------------------
  // staleEntities — placeholder; implemented in B6
  // -------------------------------------------------------------------------
  async staleEntities(
    _userId: string,
    _sinceDays: number,
    _minImportance?: number,
  ): Promise<Entity[]> {
    throw new Error('staleEntities not yet implemented — Task B6');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all structural tests in "skeleton + upsertEntity" describe block PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph skeleton + upsertEntity + storeEntityEmbedding (B1)"
```

---

### Task B2: `getEntity(id)` — simple lookup

**Files:**
- Modify: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts`


- [ ] **Step 1: Add failing structural test for getEntity**

Append to `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
describe('postgres-impl.ts structural — getEntity', () => {
  it('getEntity exported as async method', () => {
    expect(SRC).toMatch(/async getEntity\s*\(/);
  });

  it('getEntity calls prisma.entity.findUnique', () => {
    const start = SRC.indexOf('async getEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 400);
    expect(body).toContain('prisma.entity.findUnique');
  });

  it('getEntity does NOT throw for missing entity (returns null)', () => {
    const start = SRC.indexOf('async getEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 400);
    expect(body).toContain('null');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — `getEntity not yet implemented` thrown OR structural assertions fail because placeholder body doesn't contain `prisma.entity.findUnique`.

- [ ] **Step 3: Implement `getEntity` in `postgres-impl.ts`**

Replace the `getEntity` placeholder method body in `postgres-impl.ts`:

```typescript
  async getEntity(id: string): Promise<Entity | null> {
    return prisma.entity.findUnique({ where: { id } });
  }
```

(Replace the 3-line placeholder starting `async getEntity(_id: string)` through its closing `}`)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all getEntity structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph.getEntity — findUnique by id (B2)"
```

---

### Task B3: `resolveEntity` — tiered FTS then embedding fallback

**Files:**
- Modify: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts`

**Logic:**
1. FTS on `name` column: `to_tsvector('russian', name) @@ plainto_tsquery('russian', mention)`
2. FTS on `aliases` array: `unnest(aliases)` + FTS match
3. pgvector cosine if Voyage available: `embedding <=> $vec ORDER BY ASC LIMIT 1`
4. Return best single result or null

- [ ] **Step 1: Add failing structural test**

Append to `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
describe('postgres-impl.ts structural — resolveEntity', () => {
  it('resolveEntity exported as async method', () => {
    expect(SRC).toMatch(/async resolveEntity\s*\(/);
  });

  it('resolveEntity uses plainto_tsquery for name FTS', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('plainto_tsquery');
  });

  it('resolveEntity falls back to embedding similarity when embeddingsEnabled', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('embeddingsEnabled');
    // pgvector cosine operator
    expect(body).toContain('<=>');
  });

  it('resolveEntity returns null if no match (not throw)', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('return null');
  });

  it('resolveEntity filters by type if provided', () => {
    const start = SRC.indexOf('async resolveEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('type');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — resolveEntity structural assertions fail (placeholder throws).

- [ ] **Step 3: Implement `resolveEntity` in `postgres-impl.ts`**

Replace the `resolveEntity` placeholder with:

```typescript
  async resolveEntity(userId: string, mention: string, type?: string): Promise<Entity | null> {
    const mentionClean = mention.trim().slice(0, 255);
    if (!mentionClean) return null;

    const typeFilter = type ? `AND e.type = '${type.replace(/'/g, "''")}'` : '';

    // Step 1: FTS match on canonical name (russian stemming).
    const nameFts = await prisma.$queryRawUnsafe<Entity[]>(
      `SELECT e.*
       FROM "Entity" e
       WHERE e."userId" = $1
         AND to_tsvector('russian', e.name) @@ plainto_tsquery('russian', $2)
         ${typeFilter}
       ORDER BY ts_rank(to_tsvector('russian', e.name), plainto_tsquery('russian', $2)) DESC
       LIMIT 1`,
      userId,
      mentionClean,
    );
    if (nameFts.length > 0) return nameFts[0];

    // Step 2: FTS match on aliases (unnested).
    const aliasFts = await prisma.$queryRawUnsafe<Entity[]>(
      `SELECT DISTINCT e.*
       FROM "Entity" e,
            unnest(e.aliases) AS alias_val
       WHERE e."userId" = $1
         AND to_tsvector('russian', alias_val) @@ plainto_tsquery('russian', $2)
         ${typeFilter}
       ORDER BY e.importance DESC
       LIMIT 1`,
      userId,
      mentionClean,
    );
    if (aliasFts.length > 0) return aliasFts[0];

    // Step 3: Embedding cosine similarity fallback.
    if (embeddingsEnabled()) {
      const { embedQuery } = await import('../embeddings.js');
      const qvec = await embedQuery(mentionClean);
      if (qvec) {
        const vecLit = toVectorLiteral(qvec);
        const typeFilterEmbed = type ? `AND e.type = '${type.replace(/'/g, "''")}'` : '';
        const embResult = await prisma.$queryRawUnsafe<Entity[]>(
          `SELECT e.*
           FROM "Entity" e
           WHERE e."userId" = $1
             AND e.embedding IS NOT NULL
             ${typeFilterEmbed}
           ORDER BY e.embedding <=> $2::vector
           LIMIT 1`,
          userId,
          vecLit,
        );
        if (embResult.length > 0) return embResult[0];
      }
    }

    return null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all resolveEntity structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph.resolveEntity — tiered FTS + embedding (B3)"
```

---

### Task B4: `linkEntities` — idempotent relationship upsert

**Files:**
- Modify: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts`

**Logic:** Check for existing row matching `(userId, fromId, toId, type)` where `invalidAt IS NULL`. If exists → `UPDATE strength = MAX(existing, new)`. If not → `CREATE`. This prevents duplicate triples accumulating from repeated mentions.

The `@@unique([userId, fromId, toId, type, validAt])` constraint in schema allows multiple rows for same triple at different `validAt` timestamps. Our idempotency guard operates on the CURRENT active relationship (invalidAt IS NULL) to avoid same-day duplicates.


- [ ] **Step 1: Add failing structural test**

Append to `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
describe('postgres-impl.ts structural — linkEntities', () => {
  it('linkEntities exported as async method', () => {
    expect(SRC).toMatch(/async linkEntities\s*\(/);
  });

  it('linkEntities checks for existing active relationship before creating', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    // Must find existing before deciding to create
    const hasFindFirst = body.includes('prisma.entityRelationship.findFirst');
    const hasQueryRaw = body.includes('$queryRaw');
    expect(hasFindFirst || hasQueryRaw).toBe(true);
  });

  it('linkEntities updates strength on duplicate triple (no new row)', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.entityRelationship.update');
    expect(body).toContain('strength');
  });

  it('linkEntities creates new row when no existing active triple', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.entityRelationship.create');
  });

  it('linkEntities defaults strength to 0.5 when not provided', () => {
    const start = SRC.indexOf('async linkEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('0.5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — linkEntities structural tests fail (placeholder throws).

- [ ] **Step 3: Implement `linkEntities` in `postgres-impl.ts`**

Replace the `linkEntities` placeholder with:

```typescript
  async linkEntities(
    userId: string,
    fromId: string,
    toId: string,
    type: string,
    opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship> {
    const strength = opts?.strength ?? 0.5;
    const label = opts?.label ?? null;

    // Check for existing active (invalidAt IS NULL) relationship of same triple.
    const existing = await prisma.entityRelationship.findFirst({
      where: {
        userId,
        fromId,
        toId,
        type,
        invalidAt: null,
      },
    });

    if (existing) {
      // Idempotent: update strength (take the MAX — relationship can only
      // strengthen, not weaken on repeated mention).
      return prisma.entityRelationship.update({
        where: { id: existing.id },
        data: {
          strength: Math.max(existing.strength, strength),
          label: label ?? existing.label,
        },
      });
    }

    // No active triple → create new relationship row.
    return prisma.entityRelationship.create({
      data: {
        userId,
        fromId,
        toId,
        type,
        label,
        strength,
        validAt: new Date(),
        invalidAt: null,
      },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all linkEntities structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph.linkEntities — idempotent triple upsert (B4)"
```

---

### Task B5: `getNeighbors` — recursive CTE with depth cap=5

**Files:**
- Modify: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts`

**Note on the CTE:** The design-doc SQL uses `UNION` (deduplicating). The recursive step follows only outgoing edges (`r."fromId" = n.entityId`) for simplicity — the base case covers both directions. This prevents exponential traversal while still finding indirect connections. The `$queryRawUnsafe` pattern (not tagged template) is required because depth is a variable bind parameter.

- [ ] **Step 1: Write pure helper unit test for depth clamping**

Pure helper `clampDepth` will be exported from `postgres-impl.ts` and is unit-testable without DB.

Append to `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
import { clampDepth } from './postgres-impl.js';

describe('clampDepth — pure helper', () => {
  it('passes through values 1..5', () => {
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(3)).toBe(3);
    expect(clampDepth(5)).toBe(5);
  });

  it('clamps 0 to 1 (minimum useful depth)', () => {
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(-5)).toBe(1);
  });

  it('clamps > 5 to 5 (prevents runaway CTE)', () => {
    expect(clampDepth(6)).toBe(5);
    expect(clampDepth(100)).toBe(5);
  });
});

describe('postgres-impl.ts structural — getNeighbors', () => {
  it('getNeighbors exported as async method', () => {
    expect(SRC).toMatch(/async getNeighbors\s*\(/);
  });

  it('getNeighbors uses WITH RECURSIVE CTE', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('WITH RECURSIVE');
  });

  it('getNeighbors calls clampDepth before executing query', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('clampDepth(');
  });

  it('getNeighbors filters invalidAt IS NULL in CTE', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('invalidAt');
    expect(body).toContain('IS NULL');
  });

  it('getNeighbors uses $queryRawUnsafe (not tagged template — needs params)', () => {
    const start = SRC.indexOf('async getNeighbors');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('$queryRawUnsafe');
  });

  it('clampDepth exported from module', () => {
    expect(SRC).toMatch(/export function clampDepth/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — `clampDepth` not exported yet, getNeighbors structural tests fail.

- [ ] **Step 3: Implement `clampDepth` pure helper + `getNeighbors` in `postgres-impl.ts`**

Add `clampDepth` export near the top of the file (after imports, before the class):

```typescript
/**
 * Clamp graph traversal depth to [1, 5].
 * Prevents runaway recursive CTE. Min=1 (otherwise query is pointless).
 * Exported for unit testing.
 */
export function clampDepth(depth: number): number {
  return Math.max(1, Math.min(5, depth));
}
```

Replace the `getNeighbors` placeholder with:

```typescript
  async getNeighbors(
    entityId: string,
    depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>> {
    const safeDepth = clampDepth(depth);

    // Recursive CTE with depth cap.
    // Base: direct neighbors (both directions, distance=1).
    // Recursive: follow outgoing edges from discovered neighbors.
    // UNION (not UNION ALL) deduplicates entityId per distance tier.
    type NeighborRow = Entity & {
      distance: number;
      rel_id: string;
      rel_userId: string;
      rel_fromId: string;
      rel_toId: string;
      rel_type: string;
      rel_label: string | null;
      rel_strength: number;
      rel_validAt: Date;
      rel_invalidAt: Date | null;
      rel_createdAt: Date;
      rel_updatedAt: Date;
    };

    const rows = await prisma.$queryRawUnsafe<NeighborRow[]>(
      `WITH RECURSIVE neighbors AS (
        -- base: outgoing direct neighbors
        SELECT r."toId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               1 AS distance, r.id AS "relId"
        FROM "EntityRelationship" r
        WHERE r."fromId" = $1 AND r."invalidAt" IS NULL

        UNION

        -- base: incoming direct neighbors (bidirectional)
        SELECT r."fromId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               1 AS distance, r.id AS "relId"
        FROM "EntityRelationship" r
        WHERE r."toId" = $1 AND r."invalidAt" IS NULL

        UNION

        -- recursive: outgoing from discovered neighbors
        SELECT r."toId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               n.distance + 1 AS distance, r.id AS "relId"
        FROM neighbors n
        JOIN "EntityRelationship" r ON r."fromId" = n."entityId"
        WHERE n.distance < $2 AND r."invalidAt" IS NULL
      )
      SELECT DISTINCT ON (e.id)
        e.*,
        n.distance,
        r.id         AS "rel_id",
        r."userId"   AS "rel_userId",
        r."fromId"   AS "rel_fromId",
        r."toId"     AS "rel_toId",
        r.type       AS "rel_type",
        r.label      AS "rel_label",
        r.strength   AS "rel_strength",
        r."validAt"  AS "rel_validAt",
        r."invalidAt" AS "rel_invalidAt",
        r."createdAt" AS "rel_createdAt",
        r."updatedAt" AS "rel_updatedAt"
      FROM neighbors n
      JOIN "Entity" e ON e.id = n."entityId"
      JOIN "EntityRelationship" r ON r.id = n."relId"
      WHERE e.id != $1
      ORDER BY e.id, n.distance ASC, e.importance DESC`,
      entityId,
      safeDepth,
    );

    return rows.map((row) => ({
      entity: {
        id: row.id,
        userId: row.userId,
        type: row.type,
        name: row.name,
        aliases: row.aliases,
        attributes: row.attributes,
        lastSeenAt: row.lastSeenAt,
        baselineFreq: row.baselineFreq,
        moodAvg: row.moodAvg,
        importance: row.importance,
        embedding: row.embedding,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } as Entity,
      relation: {
        id: row.rel_id,
        userId: row.rel_userId,
        fromId: row.rel_fromId,
        toId: row.rel_toId,
        type: row.rel_type,
        label: row.rel_label,
        strength: row.rel_strength,
        validAt: row.rel_validAt,
        invalidAt: row.rel_invalidAt,
        createdAt: row.rel_createdAt,
        updatedAt: row.rel_updatedAt,
      } as EntityRelationship,
      distance: row.distance,
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all clampDepth unit tests + getNeighbors structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph.getNeighbors — recursive CTE depth-capped (B5)"
```

---

### Task B6: `staleEntities` query

**Files:**
- Modify: `packages/server/src/services/entity-graph/postgres-impl.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts`


- [ ] **Step 1: Write pure helper unit test for `sinceDaysCutoff`**

Pure helper `sinceDaysCutoff(days, now?)` computes the cutoff Date. Exported for unit testing.

Append to `packages/server/src/services/entity-graph/postgres-impl.test.ts`:

```typescript
import { sinceDaysCutoff } from './postgres-impl.js';

describe('sinceDaysCutoff — pure helper', () => {
  it('returns date exactly N days before now', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const cutoff = sinceDaysCutoff(7, now);
    const expectedMs = now.getTime() - 7 * 86_400_000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it('works for 0 days (returns now)', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const cutoff = sinceDaysCutoff(0, now);
    expect(cutoff.getTime()).toBe(now.getTime());
  });

  it('works for 30 days', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const cutoff = sinceDaysCutoff(30, now);
    const expected = new Date('2026-05-02T00:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });
});

describe('postgres-impl.ts structural — staleEntities', () => {
  it('staleEntities exported as async method', () => {
    expect(SRC).toMatch(/async staleEntities\s*\(/);
  });

  it('staleEntities filters lastSeenAt before cutoff', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('lastSeenAt');
    expect(body).toContain('lt:');
  });

  it('staleEntities applies minImportance filter when provided', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('minImportance');
    expect(body).toContain('gte:');
  });

  it('staleEntities orders by importance DESC', () => {
    const start = SRC.indexOf('async staleEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/orderBy.*importance.*desc/s);
  });

  it('sinceDaysCutoff exported from module', () => {
    expect(SRC).toMatch(/export function sinceDaysCutoff/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: FAIL — `sinceDaysCutoff` not exported, staleEntities structural fails.

- [ ] **Step 3: Implement `sinceDaysCutoff` + `staleEntities` in `postgres-impl.ts`**

Add `sinceDaysCutoff` export near `clampDepth` (in the internal helpers section):

```typescript
/**
 * Compute cutoff Date = now - sinceDays * 24h.
 * Exported for unit testing.
 */
export function sinceDaysCutoff(sinceDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - sinceDays * 86_400_000);
}
```

Replace the `staleEntities` placeholder with:

```typescript
  async staleEntities(userId: string, sinceDays: number, minImportance?: number): Promise<Entity[]> {
    const cutoff = sinceDaysCutoff(sinceDays);
    return prisma.entity.findMany({
      where: {
        userId,
        lastSeenAt: { lt: cutoff },
        ...(minImportance !== undefined ? { importance: { gte: minImportance } } : {}),
      },
      orderBy: { importance: 'desc' },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/postgres-impl.test.ts
```

Expected: all sinceDaysCutoff unit tests + staleEntities structural tests PASS.

- [ ] **Step 5: Full test suite check**

```bash
cd packages/server
npm test
```

Expected: 894 passing + new tests (all green).

- [ ] **Step 6: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/entity-graph/postgres-impl.ts \
        packages/server/src/services/entity-graph/postgres-impl.test.ts
git commit -m "feat(v2-entity): PostgresEntityGraph.staleEntities + sinceDaysCutoff helper (B6)"
```

---

## Section C — EntityExtractor (2 tasks)

### Task C1: Skeleton + pure helpers

**Files:**
- Create: `packages/server/src/services/entity-extractor.ts`
- Create: `packages/server/src/services/entity-extractor.test.ts`

**Pure helpers to export:**
- `normalizeEntityName(raw: string): string` — trim, collapse whitespace, capitalize first letter
- `parseExtractorResponse(raw: string): ExtractorResult` — parse Claude JSON, return typed result or empty-arrays fallback (never throws)


- [ ] **Step 1: Write failing tests for pure helpers**

Create `packages/server/src/services/entity-extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeEntityName, parseExtractorResponse } from './entity-extractor.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Pure helper: normalizeEntityName
// ---------------------------------------------------------------------------

describe('normalizeEntityName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeEntityName('  мама  ')).toBe('Мама');
  });

  it('collapses internal whitespace to single space', () => {
    expect(normalizeEntityName('Серик   Жумабаев')).toBe('Серик Жумабаев');
  });

  it('capitalizes first letter (Russian)', () => {
    expect(normalizeEntityName('работа')).toBe('Работа');
  });

  it('preserves already-capitalized names', () => {
    expect(normalizeEntityName('Алматы')).toBe('Алматы');
  });

  it('handles empty string gracefully', () => {
    expect(normalizeEntityName('')).toBe('');
  });

  it('handles single-char string', () => {
    expect(normalizeEntityName('а')).toBe('А');
  });
});

// ---------------------------------------------------------------------------
// Pure helper: parseExtractorResponse
// ---------------------------------------------------------------------------

describe('parseExtractorResponse — valid JSON', () => {
  it('parses valid entities + relationships', () => {
    const raw = JSON.stringify({
      entities: [
        { name: 'мама', type: 'person', attributes: { city: 'Алматы' } },
        { name: 'работа', type: 'concept' },
      ],
      relationships: [
        { fromName: 'мама', toName: 'работа', type: 'concern' },
      ],
    });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].name).toBe('мама');
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].type).toBe('concern');
  });

  it('handles missing relationships key → empty array', () => {
    const raw = JSON.stringify({ entities: [{ name: 'Серик', type: 'person' }] });
    const result = parseExtractorResponse(raw);
    expect(result.relationships).toEqual([]);
  });

  it('handles missing entities key → empty array', () => {
    const raw = JSON.stringify({ relationships: [] });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toEqual([]);
  });
});

describe('parseExtractorResponse — malformed / fallback', () => {
  it('returns empty arrays for invalid JSON (never throws)', () => {
    const result = parseExtractorResponse('not json at all');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('strips markdown code fences before parsing', () => {
    const inner = JSON.stringify({ entities: [{ name: 'X', type: 'concept' }], relationships: [] });
    const wrapped = '```json\n' + inner + '\n```';
    const result = parseExtractorResponse(wrapped);
    expect(result.entities).toHaveLength(1);
  });

  it('returns empty arrays for null/undefined response', () => {
    expect(parseExtractorResponse('')).toEqual({ entities: [], relationships: [] });
  });

  it('returns empty arrays when entities is not an array', () => {
    const raw = JSON.stringify({ entities: 'wrong', relationships: [] });
    const result = parseExtractorResponse(raw);
    expect(result.entities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-extractor.ts'),
  'utf-8',
);

describe('entity-extractor.ts structural — skeleton', () => {
  it('exports normalizeEntityName function', () => {
    expect(SRC).toMatch(/export function normalizeEntityName/);
  });

  it('exports parseExtractorResponse function', () => {
    expect(SRC).toMatch(/export function parseExtractorResponse/);
  });

  it('exports ExtractorResult type', () => {
    expect(SRC).toMatch(/export.*ExtractorResult/);
  });

  it('exports ExtractedEntityInput type', () => {
    expect(SRC).toMatch(/export.*ExtractedEntityInput/);
  });

  it('exports ExtractedRelationshipInput type', () => {
    expect(SRC).toMatch(/export.*ExtractedRelationshipInput/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-extractor.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory ... entity-extractor.ts`

- [ ] **Step 3: Create `entity-extractor.ts` with types + pure helpers**

Create `packages/server/src/services/entity-extractor.ts`:

```typescript
/**
 * v2.0 Tier 3 — EntityExtractor: Claude-based entity + relationship extraction.
 *
 * Takes free text (chat message, dictation transcript) and returns:
 *   - entities detected (name, type, optional attributes)
 *   - relationships between detected entities
 *
 * Pattern mirrors extractFromTranscript in dictation-service.ts:
 *   - Single Claude call with JSON-only system prompt
 *   - Best-effort: failure → return empty arrays (never throws)
 *   - MODELS.haiku (fast, cheap — extraction is a batch classify task)
 *
 * Pure helpers (normalizeEntityName, parseExtractorResponse) are exported
 * separately for unit testing without DB/Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../lib/models.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEntityInput {
  /** Raw name from text — will be normalized by caller via upsertEntity. */
  name: string;
  /** 'person' | 'place' | 'concept' | 'goal' | 'organization' */
  type: string;
  /** Optional free-form attributes extracted from context. */
  attributes?: Record<string, unknown>;
  /** 1-10 importance signal from extraction context. Default 5. */
  importance?: number;
}

export interface ExtractedRelationshipInput {
  /** Name of the "from" entity (matches entities[] name). */
  fromName: string;
  /** Name of the "to" entity (matches entities[] name). */
  toName: string;
  /**
   * Relationship type: 'family'|'friend'|'colleague'|'partner'|
   * 'concern'|'goal_link'|'location'|'works_at'|'lives_in'|'connected_to'
   */
  type: string;
  /** Optional free-form label. */
  label?: string;
  /** 0..1 estimated relationship strength. Default 0.5. */
  strength?: number;
}

export interface ExtractorResult {
  entities: ExtractedEntityInput[];
  relationships: ExtractedRelationshipInput[];
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB/Claude)
// ---------------------------------------------------------------------------

/**
 * Normalize a raw entity name from Claude extraction:
 *   - trim leading/trailing whitespace
 *   - collapse internal whitespace to single space
 *   - capitalize first letter
 *
 * Examples: "  мама  " → "Мама", "Серик   Жумабаев" → "Серик Жумабаев"
 */
export function normalizeEntityName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Parse Claude JSON response into ExtractorResult.
 * Handles:
 *   - Markdown code fences (```json ... ```)
 *   - Missing keys → empty arrays
 *   - Non-array values → empty arrays
 *   - Invalid JSON → empty arrays (log warn, never throw)
 */
export function parseExtractorResponse(raw: string): ExtractorResult {
  const empty: ExtractorResult = { entities: [], relationships: [] };
  if (!raw || !raw.trim()) return empty;

  let text = raw.trim();
  // Strip markdown code fences (same pattern as dictation-service.ts).
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const entities = Array.isArray(parsed.entities)
      ? (parsed.entities as ExtractedEntityInput[])
      : [];
    const relationships = Array.isArray(parsed.relationships)
      ? (parsed.relationships as ExtractedRelationshipInput[])
      : [];
    return { entities, relationships };
  } catch (err) {
    console.warn('[entity-extractor] JSON parse failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Async API (Claude call — implemented in Task C2)
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/**
 * Extract entities and relationships from free text via Claude.
 * Best-effort: any error → returns empty ExtractorResult (never throws).
 * Uses MODELS.haiku (fast, cheap — extraction is classify, not reasoning).
 *
 * Implemented in Task C2.
 */
export async function extractEntities(
  _text: string,
  _userId: string,
): Promise<ExtractorResult> {
  // Placeholder — implemented in C2.
  void anthropic; // reference to prevent unused-import lint
  return { entities: [], relationships: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-extractor.test.ts
```

Expected: all pure helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-extractor.ts \
        packages/server/src/services/entity-extractor.test.ts
git commit -m "feat(v2-entity): EntityExtractor skeleton + pure helpers normalizeEntityName + parseExtractorResponse (C1)"
```

---

### Task C2: `extractEntities` async Claude call + structured result

**Files:**
- Modify: `packages/server/src/services/entity-extractor.ts`
- Modify: `packages/server/src/services/entity-extractor.test.ts`


- [ ] **Step 1: Add failing structural tests for `extractEntities`**

Append to `packages/server/src/services/entity-extractor.test.ts`:

```typescript
describe('entity-extractor.ts structural — extractEntities async', () => {
  it('extractEntities exported as async function', () => {
    expect(SRC).toMatch(/export async function extractEntities\s*\(/);
  });

  it('extractEntities calls anthropic.messages.create', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
  });

  it('extractEntities uses MODELS.haiku (fast/cheap for classify tasks)', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('MODELS.haiku');
  });

  it('extractEntities wraps entire call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
    // On error, must return empty (not throw)
    expect(body).toContain('entities: []');
  });

  it('extractEntities calls parseExtractorResponse to parse Claude output', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseExtractorResponse(');
  });

  it('extractEntities normalizes entity names via normalizeEntityName', () => {
    const start = SRC.indexOf('export async function extractEntities');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('normalizeEntityName(');
  });

  it('extractEntities system prompt includes JSON-only instruction', () => {
    // The system prompt must instruct Claude to return ONLY valid JSON.
    expect(SRC).toMatch(/ТОЛЬКО.*JSON|ONLY.*JSON|valid JSON/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-extractor.test.ts
```

Expected: FAIL — structural tests catch that the placeholder doesn't call `anthropic.messages.create`, doesn't use `MODELS.haiku`, etc.

- [ ] **Step 3: Implement `extractEntities` in `entity-extractor.ts`**

Replace the `extractEntities` function (remove the placeholder, replace with full implementation):

```typescript
const ENTITY_TYPES = ['person', 'place', 'concept', 'goal', 'organization'] as const;
const RELATIONSHIP_TYPES = [
  'family', 'friend', 'colleague', 'partner',
  'concern', 'goal_link', 'location', 'works_at', 'lives_in', 'connected_to',
] as const;

const SYSTEM_PROMPT = `Ты — аналитик знаний LifeOS. Из сообщения пользователя извлеки ТОЛЬКО именованные сущности и связи между ними.

Верни ТОЛЬКО валидный JSON без markdown, строго такого формата:
{
  "entities": [
    {
      "name": "каноническое имя сущности",
      "type": "person|place|concept|goal|organization",
      "attributes": { "ключ": "значение" },
      "importance": 5
    }
  ],
  "relationships": [
    {
      "fromName": "имя сущности A",
      "toName": "имя сущности B",
      "type": "family|friend|colleague|partner|concern|goal_link|location|works_at|lives_in|connected_to",
      "label": "опциональное описание",
      "strength": 0.5
    }
  ]
}

Правила:
1. entities — только явно упомянутые. Не выдумывай. Мин. одно слово.
2. type выбери из фиксированного списка: ${ENTITY_TYPES.join('|')}.
3. attributes — только явно сказанное (день рождения, город, профессия и т.д.).
4. importance: 1-3 мелочь, 4-6 средне, 7-10 важно (семья, здоровье, цели).
5. relationships — только если из текста явно следует связь между двумя entities.
6. relationship.type из: ${RELATIONSHIP_TYPES.join('|')}.
7. Если entities нет — верни { "entities": [], "relationships": [] }.
8. НЕ добавляй объяснений, только JSON.`;

/**
 * Extract entities and relationships from free text via Claude.
 *
 * Best-effort: any error (network, parse, Claude 5xx) → returns empty
 * ExtractorResult and logs warn. Never throws.
 *
 * Normalizes entity names before returning (capitalizes, collapses spaces).
 */
export async function extractEntities(
  text: string,
  _userId: string,
): Promise<ExtractorResult> {
  const trimmed = text.trim();
  if (!trimmed) return { entities: [], relationships: [] };

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.warn('[entity-extractor] empty or non-text Claude response');
      return { entities: [], relationships: [] };
    }

    const parsed = parseExtractorResponse(content.text);

    // Normalize entity names.
    const normalizedEntities: ExtractedEntityInput[] = parsed.entities.map((e) => ({
      ...e,
      name: normalizeEntityName(e.name),
    }));

    // Normalize relationship fromName/toName to match normalized entity names.
    const normalizedRelationships: ExtractedRelationshipInput[] = parsed.relationships.map((r) => ({
      ...r,
      fromName: normalizeEntityName(r.fromName),
      toName: normalizeEntityName(r.toName),
    }));

    return { entities: normalizedEntities, relationships: normalizedRelationships };
  } catch (err) {
    console.warn(
      '[entity-extractor] extractEntities failed:',
      err instanceof Error ? err.message : err,
    );
    return { entities: [], relationships: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-extractor.test.ts
```

Expected: all extractEntities structural tests PASS.

- [ ] **Step 5: Full test suite check**

```bash
cd packages/server
npm test
```

Expected: all tests green (894 original + new tests).

- [ ] **Step 6: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/entity-extractor.ts \
        packages/server/src/services/entity-extractor.test.ts
git commit -m "feat(v2-entity): EntityExtractor.extractEntities — Claude haiku + best-effort JSON parse (C2)"
```

---

## Section D — Verify + Wrap-up (2 tasks)

### Task D1: Singleton accessor in `entity-graph/index.ts` + smoke test

**Files:**
- Create: `packages/server/src/services/entity-graph/index.ts`
- Modify: `packages/server/src/services/entity-graph/postgres-impl.test.ts` (add structural test)


- [ ] **Step 1: Write failing structural test for index.ts**

Create `packages/server/src/services/entity-graph/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-graph/index.ts'),
  'utf-8',
);

describe('entity-graph/index.ts structural', () => {
  it('exports getEntityGraph singleton accessor', () => {
    expect(SRC).toMatch(/export function getEntityGraph/);
  });

  it('exports _resetEntityGraphForTests (test helper)', () => {
    expect(SRC).toMatch(/export function _resetEntityGraphForTests/);
  });

  it('re-exports EntityGraphStore type', () => {
    expect(SRC).toContain('EntityGraphStore');
  });

  it('re-exports PostgresEntityGraph', () => {
    expect(SRC).toContain('PostgresEntityGraph');
  });

  it('singleton returns same instance on subsequent calls', async () => {
    // Import after SRC read to avoid stale module cache affecting SRC.
    const { getEntityGraph, _resetEntityGraphForTests } = await import('./index.js');
    _resetEntityGraphForTests();
    const a = getEntityGraph();
    const b = getEntityGraph();
    expect(a).toBe(b);
  });

  it('_resetEntityGraphForTests creates fresh instance', async () => {
    const { getEntityGraph, _resetEntityGraphForTests } = await import('./index.js');
    _resetEntityGraphForTests();
    const a = getEntityGraph();
    _resetEntityGraphForTests();
    const b = getEntityGraph();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/index.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory ... index.ts`

- [ ] **Step 3: Create `entity-graph/index.ts`**

Create `packages/server/src/services/entity-graph/index.ts`:

```typescript
/**
 * v2.0 Tier 3 — Entity Graph public entry point.
 *
 * Exports interface, implementation, and singleton accessor.
 * Pattern mirrors working-memory.ts: lazy singleton + test reset.
 *
 * Singleton wired into jarvis-orchestrator in Week 5 (separate plan).
 */

export type { EntityGraphStore, Entity, EntityRelationship } from './types.js';
export { PostgresEntityGraph } from './postgres-impl.js';
export { clampDepth, sinceDaysCutoff } from './postgres-impl.js';

import { PostgresEntityGraph } from './postgres-impl.js';
import type { EntityGraphStore } from './types.js';

let _instance: EntityGraphStore | null = null;

/**
 * Global singleton instance of the entity graph store.
 * Created lazily on first call. Uses PostgresEntityGraph by default.
 *
 * Wired into jarvis-orchestrator in Week 5.
 */
export function getEntityGraph(): EntityGraphStore {
  if (!_instance) {
    _instance = new PostgresEntityGraph();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files.
 * Underscore prefix signals "internal API" (mirrors working-memory.ts pattern).
 */
export function _resetEntityGraphForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/entity-graph/index.test.ts
```

Expected: all structural + singleton tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/entity-graph/index.ts \
        packages/server/src/services/entity-graph/index.test.ts
git commit -m "feat(v2-entity): entity-graph singleton accessor + public index re-exports (D1)"
```

---

### Task D2: Full verification — test suite + tsc + progress note

**Files:**
- No new files — verification only.

- [ ] **Step 1: Run full test suite**

```bash
cd packages/server
npm test
```

Expected output (all green):
```
✓ src/services/entity-graph/postgres-impl.test.ts (N tests)
✓ src/services/entity-graph/index.test.ts (N tests)
✓ src/services/entity-extractor.test.ts (N tests)
...all previously-passing tests still pass...
Test Files: N passed
Tests: N passed (≥ 894 + new tests)
```

- [ ] **Step 2: TypeScript strict check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: `Exit code 0` — no errors.

- [ ] **Step 3: Verify no `vi.mock` introduced**

```bash
grep -r "vi\.mock" packages/server/src/ | wc -l
```

Expected: `0`

- [ ] **Step 4: Verify all EntityGraphStore methods are implemented (no placeholder throws remain)**

```bash
grep -n "not yet implemented" packages/server/src/services/entity-graph/postgres-impl.ts
```

Expected: empty output (zero lines — all placeholders replaced).

- [ ] **Step 5: Verify extractEntities is not a placeholder**

```bash
grep -n "Placeholder\|not yet implemented" packages/server/src/services/entity-extractor.ts
```

Expected: empty output.

- [ ] **Step 6: Verify file structure**

```bash
ls packages/server/src/services/entity-graph/
ls packages/server/src/services/entity-extractor.ts
ls packages/server/src/services/entity-extractor.test.ts
```

Expected:
```
index.test.ts  index.ts  postgres-impl.test.ts  postgres-impl.ts  types.ts
entity-extractor.ts
entity-extractor.test.ts
```

- [ ] **Step 7: Final commit — progress tracker**

```bash
git add packages/server/src/services/entity-graph/ \
        packages/server/src/services/entity-extractor.ts \
        packages/server/src/services/entity-extractor.test.ts
git commit -m "docs(v2-progress): Week 3 DONE — Tier 3 Entity Graph + EntityExtractor"
```

---

## Self-Review

### 1. Spec Coverage

| EntityGraphStore method | Task |
|---|---|
| `resolveEntity` | B3 — tiered FTS → aliases → embedding |
| `upsertEntity` | B1 — prisma upsert, alias merge, embedding |
| `getEntity` | B2 — `findUnique` |
| `linkEntities` | B4 — idempotent findFirst + update/create |
| `getNeighbors` | B5 — recursive CTE, clampDepth |
| `staleEntities` | B6 — `lastSeenAt lt cutoff`, minImportance filter |
| `extractEntities` | C2 — Claude haiku, parseExtractorResponse |
| Pure helpers | B5 `clampDepth`, B6 `sinceDaysCutoff`, C1 `normalizeEntityName`/`parseExtractorResponse` |
| Singleton accessor | D1 — `getEntityGraph` + `_resetEntityGraphForTests` |
| Types file | A1 — `EntityGraphStore` interface + type re-exports |

All 6 interface methods covered. All edge cases from spec addressed:

| Edge case | Where handled |
|---|---|
| Two different "Серик" — ambiguity | `resolveEntity` returns BEST single match (caller resolves via context — Week 5) |
| Entity rename → aliases extended | `upsertEntity` B1 — merges aliases on update |
| Circular A→B→A | `getNeighbors` CTE — `DISTINCT ON (e.id)` prevents infinite loop |
| Recursive depth runaway | `clampDepth` hard-caps at 5 |
| Deleted entity soft-delete | `linkEntities` uses `invalidAt IS NULL` guard |
| `resolveEntity` no FTS match | Falls through to embedding step |
| Voyage down | `embeddingsEnabled()` check + try/catch in `storeEntityEmbedding` |
| `linkEntities` same triple twice | `findFirst` + UPDATE strength — no new row |

### 2. Placeholder Scan

Searched for: "TBD", "TODO", "fill in", "implement appropriate", "not yet implemented".

- Task B1 skeleton intentionally includes `throw new Error('X not yet implemented — Task BN')` stubs — these are REPLACED in B2/B3/B4/B5/B6. By D2 Step 4, zero remain.
- Task C1 `extractEntities` has `return { entities: [], relationships: [] }` placeholder — replaced fully in C2.
- No other placeholders.

### 3. Type Consistency

Verified signatures match across tasks:

| Symbol | Defined in | Used in |
|---|---|---|
| `EntityGraphStore` | types.ts (A1) | postgres-impl.ts `implements`, index.ts |
| `Entity`, `EntityRelationship` | types.ts (re-export from @prisma/client) | postgres-impl.ts, index.ts |
| `clampDepth(depth: number): number` | postgres-impl.ts B5 | postgres-impl.test.ts B5, index.ts |
| `sinceDaysCutoff(days, now?)` | postgres-impl.ts B6 | postgres-impl.test.ts B6, index.ts |
| `normalizeEntityName(raw: string): string` | entity-extractor.ts C1 | entity-extractor.test.ts C1, used in C2 |
| `parseExtractorResponse(raw: string): ExtractorResult` | entity-extractor.ts C1 | entity-extractor.test.ts C1, called in C2 |
| `ExtractorResult` | entity-extractor.ts C1 | entity-extractor.test.ts, C2 |
| `getEntityGraph(): EntityGraphStore` | index.ts D1 | index.test.ts D1 |
| `_resetEntityGraphForTests()` | index.ts D1 | index.test.ts D1 |

No mismatches found.

### 4. Test Pattern Compliance

- Zero `vi.mock` — verified: all tests use pure unit (helpers) OR structural (`readFileSync` + content grep).
- structural pattern mirrors `memory-service.test.ts` and `episodic-memory.test.ts` exactly.
- Pure helpers exported separately from async methods — mirrors `memory-service.ts` (`shouldOverwriteContent`/`computeExpiresAt`) and `episodic-memory.ts` (`clampMood`/`validateEventInput`).
- Singleton reset helper (`_resetEntityGraphForTests`) mirrors `_resetWorkingMemoryForTests` in `working-memory.ts`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-v2-week3-tier3-entity-graph.md`.**

**Summary:** 11 tasks, ~60 TDD steps, ~40 new tests. Implements 6 EntityGraphStore methods (PostgresEntityGraph), Claude-based EntityExtractor, singleton accessor, and all pure helpers. No wiring to orchestrator (Week 5).

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Use skill: `superpowers:subagent-driven-development`

**2. Inline Execution** — tasks run in this session using `superpowers:executing-plans`, with checkpoints.

**Which approach?**
