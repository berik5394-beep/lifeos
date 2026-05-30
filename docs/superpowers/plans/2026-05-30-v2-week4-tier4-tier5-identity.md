# v2.0 Week 4: Tier 4 Procedural Memory (mini) + Tier 5 Emotional Memory (mini) + Identity mini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three new memory layers — Tier 4 ProceduralMemory (5 statistical pattern extractors), Tier 5 EmotionalMemory (mood per message, timeline, entity-mood, shift detection), and IdentityService mini (bot name/avatar/style upsert). Pure helpers + structural tests; zero `vi.mock`; nothing wired to `jarvis-orchestrator` (Week 5 scope).

**Architecture:**
- `ProceduralMemory` is a class with 4 service methods + 5 standalone extractor functions, each pure-orchestrator over Prisma queries. `recurring_topic` uses greedy similarity clustering (cosine ≥ 0.75 over Voyage embeddings already stored on `Memory.embedding`) — NOT k-means/HDBSCAN. `commitment` uses Claude haiku with best-effort JSON parsing (mirrors `EntityExtractor`). All extractors handle empty data gracefully (new users, no entities/habits/events).
- `EmotionalMemory` is a NEW module — does NOT replace existing `emotional-classifier.ts` (binary phrase-net for therapeutic routing). New module calls Claude haiku for structured mood JSON (`{valence, arousal, emotion}`), writes `MoodSnapshot` rows, computes timeline aggregates, and detects mood shifts (3-day avg vs 14-day baseline).
- `IdentityService` is a thin Prisma upsert wrapper for `BotIdentity` (created in Week 2 migration). On `style` update, also syncs `User.assistantStyle` for back-compat with existing 4 style routing.
- All three modules expose a singleton accessor (`_resetForTests` test helper) mirroring `working-memory.ts` and `entity-graph/index.ts`.

**Tech Stack:** TypeScript ES2022 + module=ESNext + moduleResolution=bundler (`.js` extensions in all imports), Prisma 6 + Postgres + pgvector (already migrated Week 2), Voyage AI embeddings (`embedDocument`/`embedQuery` from `services/embeddings.js`, best-effort), Anthropic Claude (`MODELS.haiku` for commitment + mood extraction), Vitest 3.x. Zero `vi.mock` — tests are pure unit (helpers) + structural (`readFileSync` grep).

---

## File Structure

**Create:**
- `packages/server/src/services/procedural-memory.ts` — `ProceduralMemory` class + 5 extractor functions + pure helpers
- `packages/server/src/services/procedural-memory.test.ts` — pure helper unit tests + structural tests
- `packages/server/src/services/procedural-memory.singleton.ts` — singleton accessor (separate file to keep DI thin)
- `packages/server/src/services/procedural-memory.singleton.test.ts` — singleton structural tests
- `packages/server/src/services/emotional-memory.ts` — `EmotionalMemory` class + Claude haiku mood extraction + pure helpers
- `packages/server/src/services/emotional-memory.test.ts` — pure helper unit tests + structural tests
- `packages/server/src/services/emotional-memory.singleton.ts` — singleton accessor
- `packages/server/src/services/emotional-memory.singleton.test.ts` — singleton structural tests
- `packages/server/src/services/bot-identity.ts` — `IdentityService` (upsert + style sync)
- `packages/server/src/services/bot-identity.test.ts` — structural tests
- `packages/server/src/services/bot-identity.singleton.ts` — singleton accessor
- `packages/server/src/services/bot-identity.singleton.test.ts` — singleton structural tests

**Modify:** None in Week 4. No schema changes. No wiring to `jarvis-orchestrator`.

---

## Task Table

| ID | Section | Title | Files | Steps |
|---|---|---|---|---|
| A1 | Interfaces | Types module (interfaces + shared types) split inline (no separate types.ts — interfaces co-located with classes per per-service module) | n/a — folded into B1/C1/D1 | n/a |
| B1 | Procedural | Class skeleton + pure helpers (medianInterval, stddev, clampConfidence, isStableInterval) | procedural-memory.ts + test | 7 |
| B2 | Procedural | `getActivePatterns` + `hasPattern` + `invalidateStale` | procedural-memory.ts + test | 6 |
| B3 | Procedural | `extractFrequencyPatterns` extractor | procedural-memory.ts + test | 7 |
| B4 | Procedural | `extractTimeOfDayPatterns` extractor + `hourHistogramWindow` helper | procedural-memory.ts + test | 7 |
| B5 | Procedural | `extractRecurringTopicPatterns` (greedy cosine clustering) + `cosineSimilarity`/`greedyCluster` helpers | procedural-memory.ts + test | 7 |
| B6 | Procedural | `extractCommitmentPatterns` (Claude haiku + parseCommitmentResponse helper) | procedural-memory.ts + test | 7 |
| B7 | Procedural | `extractStreakBreakPatterns` + `weekIndex` helper | procedural-memory.ts + test | 7 |
| B8 | Procedural | `extractPatterns` orchestrator + dedupe + singleton wrap | procedural-memory.ts + singleton + tests | 7 |
| C1 | Emotional | Class skeleton + pure helpers (clampValence, clampArousal, parseMoodResponse, normalizeEmotionLabel) + `analyzeMessage` | emotional-memory.ts + test | 8 |
| C2 | Emotional | `getMoodTimeline` + `getEntityMood` + `groupByDay` helper | emotional-memory.ts + test | 7 |
| C3 | Emotional | `detectMoodShift` + `computeShiftMagnitude` helper + singleton wrap | emotional-memory.ts + singleton + tests | 8 |
| D1 | Identity | `IdentityService` skeleton + `getIdentity` + `updateIdentity` + style sync + singleton | bot-identity.ts + singleton + tests | 8 |
| E1 | Verify | Full test suite + tsc + placeholder scan + progress commit | n/a | 7 |

**Total: 13 tasks, ~99 numbered TDD steps.**

---

## Section A — Inline interfaces

Per Week 3 retro and the smaller per-service module shape of Week 4, there is **no separate `types.ts`** for Week 4. Each module file (`procedural-memory.ts`, `emotional-memory.ts`, `bot-identity.ts`) declares its own `export interface XYZ` alongside the implementing class, mirroring `episodic-memory.ts` (Week 2) — which is the closest sibling for "single-file service with pure helpers + async methods + interface" pattern. Re-exports of Prisma types (`Pattern`, `MoodSnapshot`, `BotIdentity`) are inline `export type` lines at the top of each module.

---

## Section B — ProceduralMemory (8 tasks)

### Task B1: Class skeleton + pure helpers (medianInterval, stddev, clampConfidence, isStableInterval)

**Files:**
- Create: `packages/server/src/services/procedural-memory.ts`
- Create: `packages/server/src/services/procedural-memory.test.ts`

**Pure helpers to export (testable without DB):**
- `medianInterval(timestamps: Date[]): number` — returns median delta in days between consecutive sorted timestamps; returns `0` if `< 2` items
- `stddev(values: number[]): number` — sample standard deviation; returns `0` for `< 2` items
- `clampConfidence(observations: number): number` — `min(1, observations / 10)`; clamped to `[0, 1]`
- `isStableInterval(median: number, sd: number, threshold?: number): boolean` — true if `median > 0 && sd < threshold * median` (default `threshold = 0.5`)

- [ ] **Step 1: Write failing tests for pure helpers + structural skeleton**

Create `packages/server/src/services/procedural-memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  medianInterval,
  stddev,
  clampConfidence,
  isStableInterval,
} from './procedural-memory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// medianInterval
// ---------------------------------------------------------------------------

describe('medianInterval — pure helper', () => {
  it('returns 0 for empty list', () => {
    expect(medianInterval([])).toBe(0);
  });

  it('returns 0 for single timestamp', () => {
    expect(medianInterval([new Date('2026-05-01')])).toBe(0);
  });

  it('returns median day-delta for evenly spaced timestamps', () => {
    const ts = [
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z'),
      new Date('2026-05-07T00:00:00Z'),
    ];
    expect(medianInterval(ts)).toBe(3);
  });

  it('returns median (not mean) for unevenly spaced timestamps', () => {
    const ts = [
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-03T00:00:00Z'), // +2
      new Date('2026-05-06T00:00:00Z'), // +3
      new Date('2026-05-20T00:00:00Z'), // +14 (outlier)
    ];
    // intervals: [2,3,14] → median=3 (mean would be 6.33)
    expect(medianInterval(ts)).toBe(3);
  });

  it('handles unsorted input (sorts ascending first)', () => {
    const ts = [
      new Date('2026-05-07T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z'),
    ];
    expect(medianInterval(ts)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// stddev
// ---------------------------------------------------------------------------

describe('stddev — pure helper', () => {
  it('returns 0 for empty', () => {
    expect(stddev([])).toBe(0);
  });

  it('returns 0 for single value', () => {
    expect(stddev([5])).toBe(0);
  });

  it('returns 0 for all-equal values', () => {
    expect(stddev([3, 3, 3, 3])).toBe(0);
  });

  it('computes sample stddev (n-1 denominator)', () => {
    // values [2,4,4,4,5,5,7,9] → sample sd ≈ 2.138
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeGreaterThan(2.1);
    expect(result).toBeLessThan(2.2);
  });
});

// ---------------------------------------------------------------------------
// clampConfidence
// ---------------------------------------------------------------------------

describe('clampConfidence — pure helper', () => {
  it('returns 0 for 0 observations', () => {
    expect(clampConfidence(0)).toBe(0);
  });

  it('returns 0.5 for 5 observations', () => {
    expect(clampConfidence(5)).toBe(0.5);
  });

  it('caps at 1.0 for 10+ observations', () => {
    expect(clampConfidence(10)).toBe(1);
    expect(clampConfidence(100)).toBe(1);
  });

  it('clamps negative observations to 0', () => {
    expect(clampConfidence(-3)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isStableInterval
// ---------------------------------------------------------------------------

describe('isStableInterval — pure helper', () => {
  it('returns false if median is 0', () => {
    expect(isStableInterval(0, 0)).toBe(false);
  });

  it('returns true when sd < 50% of median (default threshold)', () => {
    expect(isStableInterval(10, 4)).toBe(true);
  });

  it('returns false when sd >= 50% of median', () => {
    expect(isStableInterval(10, 5)).toBe(false);
    expect(isStableInterval(10, 8)).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(isStableInterval(10, 2, 0.3)).toBe(true);  // 2 < 3
    expect(isStableInterval(10, 4, 0.3)).toBe(false); // 4 >= 3
  });
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  join(process.cwd(), 'src/services/procedural-memory.ts'),
  'utf-8',
);

describe('procedural-memory.ts structural — skeleton + pure helpers', () => {
  it('exports ProceduralMemory class', () => {
    expect(SRC).toMatch(/export class ProceduralMemory/);
  });

  it('exports ProceduralMemory interface (or implements)', () => {
    expect(SRC).toMatch(/implements ProceduralMemoryStore|export interface ProceduralMemory/);
  });

  it('exports medianInterval pure helper', () => {
    expect(SRC).toMatch(/export function medianInterval/);
  });

  it('exports stddev pure helper', () => {
    expect(SRC).toMatch(/export function stddev/);
  });

  it('exports clampConfidence pure helper', () => {
    expect(SRC).toMatch(/export function clampConfidence/);
  });

  it('exports isStableInterval pure helper', () => {
    expect(SRC).toMatch(/export function isStableInterval/);
  });

  it('re-exports Pattern type from @prisma/client', () => {
    expect(SRC).toMatch(/export type \{[^}]*Pattern[^}]*\}/);
  });

  it('class declares extractPatterns method (will throw placeholder)', () => {
    expect(SRC).toMatch(/async extractPatterns\s*\(/);
  });

  it('class declares getActivePatterns method', () => {
    expect(SRC).toMatch(/async getActivePatterns\s*\(/);
  });

  it('class declares hasPattern method', () => {
    expect(SRC).toMatch(/async hasPattern\s*\(/);
  });

  it('class declares invalidateStale method', () => {
    expect(SRC).toMatch(/async invalidateStale\s*\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory ... procedural-memory.ts`.

- [ ] **Step 3: Create `procedural-memory.ts` skeleton + pure helpers**

Create `packages/server/src/services/procedural-memory.ts`:

```typescript
/**
 * v2.0 Tier 4 — ProceduralMemory: statistical pattern extraction.
 *
 * Mini-version (Phase A): no ML, no skill creation. Five statistical
 * extractors operate over Episodic events, Entity table, HabitLog,
 * Memory.embedding (Voyage 512d, already stored Week 3), and recent
 * ChatMessage content. All extractors are best-effort and handle
 * empty data gracefully (new user → no patterns, no throws).
 *
 * Pattern mirrors episodic-memory.ts (Week 2):
 *   - Pure helpers (medianInterval, stddev, clampConfidence, etc.)
 *     exported separately for unit tests without DB.
 *   - Async service methods accept userId + return Prisma rows.
 *   - Class implements interface; singleton accessor in separate file.
 *
 * No wiring to jarvis-orchestrator — Week 5 scope.
 */

import { prisma } from '../lib/prisma.js';
import type { Pattern } from '@prisma/client';

// Re-export Prisma type so consumers can import from one place.
export type { Pattern };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ProceduralMemoryStore {
  extractPatterns(userId: string): Promise<Pattern[]>;
  getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]>;
  hasPattern(userId: string, kind: string, payload: object): Promise<Pattern | null>;
  invalidateStale(userId: string, staleDays?: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Compute median interval in DAYS between consecutive sorted timestamps.
 * Returns 0 if < 2 timestamps (no interval to measure).
 * Input may be unsorted — we sort ascending before computing.
 */
export function medianInterval(timestamps: Date[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000);
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[mid - 1] + intervals[mid]) / 2
    : intervals[mid];
}

/**
 * Sample standard deviation (n-1 denominator).
 * Returns 0 for < 2 items.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Map observation count → confidence in [0, 1].
 * Spec: confidence = min(1, observations / 10). Negative → 0.
 */
export function clampConfidence(observations: number): number {
  if (observations <= 0) return 0;
  return Math.min(1, observations / 10);
}

/**
 * Decide whether an interval is "stable enough" to call it a frequency
 * pattern. Stable if median > 0 and sd < threshold * median.
 * Default threshold = 0.5 (spec §6.4 Frequency extractor).
 */
export function isStableInterval(median: number, sd: number, threshold = 0.5): boolean {
  if (median <= 0) return false;
  return sd < threshold * median;
}

// ---------------------------------------------------------------------------
// ProceduralMemory implementation
// ---------------------------------------------------------------------------

export class ProceduralMemory implements ProceduralMemoryStore {
  async extractPatterns(_userId: string): Promise<Pattern[]> {
    throw new Error('extractPatterns not yet implemented — Task B8');
  }

  async getActivePatterns(
    _userId: string,
    _opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]> {
    throw new Error('getActivePatterns not yet implemented — Task B2');
  }

  async hasPattern(
    _userId: string,
    _kind: string,
    _payload: object,
  ): Promise<Pattern | null> {
    throw new Error('hasPattern not yet implemented — Task B2');
  }

  async invalidateStale(_userId: string, _staleDays = 30): Promise<number> {
    throw new Error('invalidateStale not yet implemented — Task B2');
  }
}

// Reference prisma to prevent unused-import lint (will be used in B2+).
void prisma;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: all pure helper unit tests + structural skeleton tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify no vi.mock present**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): ProceduralMemory skeleton + pure helpers (medianInterval, stddev, clampConfidence, isStableInterval) (B1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `getActivePatterns` + `hasPattern` + `invalidateStale`

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- `getActivePatterns`: `findMany` where `invalidAt IS NULL`, optional `kind IN (...)` and `confidence >= min`, order by `confidence DESC, lastObservedAt DESC`.
- `hasPattern`: `findFirst` where `userId + kind + payload` (Prisma `path` query on JSON for known kinds is overkill — payload comparison via stringification at app level). For mini-version we just match on `userId + kind` and let caller filter by payload identity; but to satisfy `hasPattern(userId, kind, payload)` semantically, we compare `JSON.stringify(payload)` with stored row's `JSON.stringify(payload)`. Returns first active match or null.
- `invalidateStale`: `updateMany` where `invalidAt IS NULL AND lastObservedAt < (now - staleDays)`, set `invalidAt = now()`. Returns count.

- [ ] **Step 1: Add failing structural tests**

Append to `packages/server/src/services/procedural-memory.test.ts`:

```typescript
describe('procedural-memory.ts structural — getActivePatterns / hasPattern / invalidateStale', () => {
  it('getActivePatterns filters invalidAt IS NULL (active only)', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt');
    expect(body).toContain('null');
  });

  it('getActivePatterns filters by kinds when provided', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('kinds');
    expect(body).toContain('in:');
  });

  it('getActivePatterns filters by minConfidence when provided', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('minConfidence');
    expect(body).toContain('gte:');
  });

  it('getActivePatterns orders by confidence DESC', () => {
    const start = SRC.indexOf('async getActivePatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/orderBy[\s\S]*?confidence[\s\S]*?desc/);
  });

  it('hasPattern uses prisma.pattern.findFirst', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('prisma.pattern.findFirst');
  });

  it('hasPattern filters invalidAt IS NULL', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt');
  });

  it('hasPattern compares payload via JSON.stringify equality', () => {
    const start = SRC.indexOf('async hasPattern');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('JSON.stringify');
  });

  it('invalidateStale uses updateMany and sets invalidAt = now', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('prisma.pattern.updateMany');
    expect(body).toContain('invalidAt');
  });

  it('invalidateStale defaults staleDays to 30', () => {
    expect(SRC).toMatch(/staleDays\s*=\s*30/);
  });

  it('invalidateStale filters lastObservedAt < cutoff', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('lastObservedAt');
    expect(body).toContain('lt:');
  });

  it('invalidateStale returns count (number)', () => {
    const start = SRC.indexOf('async invalidateStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('.count');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL — placeholder methods don't contain Prisma calls.

- [ ] **Step 3: Implement methods in `procedural-memory.ts`**

Replace the three placeholder methods (`getActivePatterns`, `hasPattern`, `invalidateStale`) with:

```typescript
  async getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]> {
    return prisma.pattern.findMany({
      where: {
        userId,
        invalidAt: null,
        ...(opts?.kinds && opts.kinds.length > 0 ? { kind: { in: opts.kinds } } : {}),
        ...(opts?.minConfidence !== undefined
          ? { confidence: { gte: opts.minConfidence } }
          : {}),
      },
      orderBy: [{ confidence: 'desc' }, { lastObservedAt: 'desc' }],
    });
  }

  async hasPattern(
    userId: string,
    kind: string,
    payload: object,
  ): Promise<Pattern | null> {
    const target = JSON.stringify(payload);
    const candidates = await prisma.pattern.findFirst({
      where: { userId, kind, invalidAt: null },
      orderBy: { lastObservedAt: 'desc' },
    });
    // Fast-path: single candidate compared via JSON.stringify of payload.
    // For mini-version we accept O(N) scan if multiple rows share kind —
    // app-level filter avoids leaning on Prisma JSON path queries.
    if (!candidates) return null;
    if (JSON.stringify(candidates.payload) === target) return candidates;

    // Scan others (rare — most users have <10 patterns per kind).
    const all = await prisma.pattern.findMany({
      where: { userId, kind, invalidAt: null },
    });
    for (const row of all) {
      if (JSON.stringify(row.payload) === target) return row;
    }
    return null;
  }

  async invalidateStale(userId: string, staleDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - staleDays * 86_400_000);
    const result = await prisma.pattern.updateMany({
      where: {
        userId,
        invalidAt: null,
        lastObservedAt: { lt: cutoff },
      },
      data: { invalidAt: new Date() },
    });
    return result.count;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: all structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): ProceduralMemory.getActivePatterns + hasPattern + invalidateStale (B2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `extractFrequencyPatterns` extractor

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- For each Entity with `importance >= 5`:
  - Get `Memory` rows where `entityRefs` includes entity.id AND `validAt >= now - 60 days`.
  - Extract `validAt` timestamps, sort ascending.
  - If `< 3` observations → skip (not enough to call a pattern).
  - Compute `medianInterval` + `stddev`. If `isStableInterval(median, sd)` → upsert Pattern.
  - `kind = 'frequency'`, `payload = { entityId, periodDays: median, lastObservedAt: max(ts) }`.
  - `observations = ts.length`, `confidence = clampConfidence(observations)`.
- Upsert semantics: if an active Pattern with same `(userId, kind, payload.entityId)` exists, update `payload.periodDays`, bump `observations`, refresh `lastObservedAt`, refresh `confidence`. Otherwise create.
- Returns array of created/updated Pattern rows.
- Best-effort: any per-entity exception → log warn, continue with other entities.

- [ ] **Step 1: Add failing structural tests**

Append to `procedural-memory.test.ts`:

```typescript
describe('procedural-memory.ts structural — extractFrequencyPatterns', () => {
  it('exports extractFrequencyPatterns as standalone async function', () => {
    expect(SRC).toMatch(/export async function extractFrequencyPatterns/);
  });

  it('filters entities by importance >= 5', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('importance');
    expect(body).toContain('gte:');
    expect(body).toContain('5');
  });

  it('queries Memory.entityRefs over last 60 days', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('entityRefs');
    expect(body).toContain('60');
  });

  it('uses medianInterval + isStableInterval helpers', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('medianInterval(');
    expect(body).toContain('isStableInterval(');
  });

  it('uses clampConfidence helper', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('clampConfidence(');
  });

  it('creates Pattern with kind=frequency', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'frequency'");
  });

  it('handles empty data (no entities) without throwing', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/return \[\]|patterns/);
  });

  it('wraps per-entity work in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractFrequencyPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL — `extractFrequencyPatterns` not exported.

- [ ] **Step 3: Implement `extractFrequencyPatterns`**

Add at the bottom of `procedural-memory.ts` (after the class, before the trailing `void prisma`):

```typescript
// ---------------------------------------------------------------------------
// Extractor: frequency
// ---------------------------------------------------------------------------

/**
 * For each Entity with importance >= 5, scan related Memory events from
 * the last 60 days. If median inter-event interval is stable
 * (sd < 50% median), upsert a Pattern{kind:'frequency'}.
 *
 * Best-effort: per-entity errors are caught and logged; we never throw.
 */
export async function extractFrequencyPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const entities = await prisma.entity.findMany({
    where: { userId, importance: { gte: 5 } },
    select: { id: true, name: true },
  });

  if (entities.length === 0) return patterns;

  const cutoff = new Date(Date.now() - 60 * 86_400_000);

  for (const entity of entities) {
    try {
      // Memory.entityRefs is a String[] — use has filter.
      const events = await prisma.memory.findMany({
        where: {
          userId,
          validAt: { gte: cutoff },
          entityRefs: { has: entity.id },
        },
        select: { validAt: true },
        orderBy: { validAt: 'asc' },
      });

      if (events.length < 3) continue; // not enough observations

      const ts = events.map((e) => e.validAt);
      const median = medianInterval(ts);
      const intervals: number[] = [];
      for (let i = 1; i < ts.length; i++) {
        intervals.push((ts[i].getTime() - ts[i - 1].getTime()) / 86_400_000);
      }
      const sd = stddev(intervals);

      if (!isStableInterval(median, sd)) continue;

      const observations = events.length;
      const confidence = clampConfidence(observations);
      const lastObservedAt = ts[ts.length - 1];
      const payload = {
        entityId: entity.id,
        periodDays: Math.round(median * 10) / 10,
        lastObservedAt: lastObservedAt.toISOString(),
      };
      const description = `упоминает ${entity.name} каждые ~${payload.periodDays} дней`;

      // Upsert: look for existing active pattern with same kind+entityId.
      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'frequency', invalidAt: null },
      });

      let row: Pattern;
      if (
        existing &&
        (existing.payload as { entityId?: string })?.entityId === entity.id
      ) {
        row = await prisma.pattern.update({
          where: { id: existing.id },
          data: {
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'frequency',
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] frequency extract failed for entity',
        entity.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: all structural tests for `extractFrequencyPatterns` PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractFrequencyPatterns — median interval stability over 60-day window (B3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `extractTimeOfDayPatterns` extractor + `hourHistogramWindow` helper

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- For each Habit with `>= 14` `HabitLog` entries (use `_count` or `findMany.length`):
  - Get all `completedAt` timestamps. (HabitLog uses `date` + `completed`. There is no `completedAt` column in the existing schema — we use `date` for habits completed=true, treating "midnight on log date" as the timestamp. For finer granularity we would need a schema change which is OUT of Week 4 scope. Mini-version: use `date` only and skip the hour histogram if all logs collapse to midnight. **Note for reviewer:** spec §6.4 says "hour-of-day distribution of completedAt"; mini-version compromise — if all logs are midnight UTC, we still register a pattern only when there's a separate `autoComplete.completedAt` field on the Habit. For Week 4, if every `date` is midnight, we skip this habit; pattern is only recorded if any meaningful hour variance exists. This is intentionally degraded — Week 6 can revisit when log-time precision is added.)
  - For each habit, compute hour histogram from any habits whose logs include `autoCompleted=true` or where `Habit.autoComplete` (JSON) contains a `completedAt` field.
  - More pragmatic mini path: also scan `Memory` events of `type='habit_completed'` (existing convention in pet-streak/habit logging) with `validAt` carrying the actual hour. If `>= 14` such events, build hour histogram over `validAt.getHours()`.
  - `hourHistogramWindow`: pure helper. Given `hours: number[]` and `windowSize=2`, find peak hour H, count items in `[H-2, H+2]` mod 24, return `{ peakHour, pct }`.
  - If `pct >= 0.7` → upsert Pattern `{ kind:'time_of_day', payload:{ habitId, hourMode: peakHour } }`, confidence = `clampConfidence(observations)`.

- [ ] **Step 1: Write failing test for `hourHistogramWindow` helper + structural tests**

Append to `procedural-memory.test.ts`:

```typescript
import { hourHistogramWindow } from './procedural-memory.js';

describe('hourHistogramWindow — pure helper', () => {
  it('returns peakHour=null when input empty', () => {
    expect(hourHistogramWindow([])).toEqual({ peakHour: null, pct: 0 });
  });

  it('finds peak hour for clustered hours', () => {
    // 10 logs at 7am, 2 at 8am, 1 at 9am → peak=7, window [5..9] = 13/13 = 1.0
    const hours = [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 9];
    const result = hourHistogramWindow(hours);
    expect(result.peakHour).toBe(7);
    expect(result.pct).toBeCloseTo(1.0, 2);
  });

  it('handles bimodal distribution by choosing first peak with most ±2h mass', () => {
    // 5 at 7am, 5 at 19pm → both equally peaks; we choose smaller hour (deterministic)
    const hours = [7, 7, 7, 7, 7, 19, 19, 19, 19, 19];
    const result = hourHistogramWindow(hours);
    expect([7, 19]).toContain(result.peakHour);
    expect(result.pct).toBeCloseTo(0.5, 2);
  });

  it('wraps window around midnight (e.g. 23, 0, 1 cluster)', () => {
    const hours = [23, 23, 23, 0, 0, 0, 1, 1, 1];
    const result = hourHistogramWindow(hours);
    // Any of 23/0/1 acceptable as peak; window ±2 covers all 9
    expect(result.pct).toBeCloseTo(1.0, 2);
  });

  it('respects custom windowSize', () => {
    const hours = [7, 7, 7, 12, 12, 12];
    // windowSize=1 → peak=7, window [6,7,8] = 3/6 = 0.5
    expect(hourHistogramWindow(hours, 1).pct).toBeCloseTo(0.5, 2);
  });
});

describe('procedural-memory.ts structural — extractTimeOfDayPatterns', () => {
  it('exports extractTimeOfDayPatterns', () => {
    expect(SRC).toMatch(/export async function extractTimeOfDayPatterns/);
  });

  it('exports hourHistogramWindow helper', () => {
    expect(SRC).toMatch(/export function hourHistogramWindow/);
  });

  it('queries habits with at least 14 logs (count or threshold check)', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('14');
  });

  it('uses hourHistogramWindow', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('hourHistogramWindow(');
  });

  it('checks pct >= 0.7 threshold (spec §6.4)', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('0.7');
  });

  it('creates Pattern with kind=time_of_day', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'time_of_day'");
  });

  it('handles no habits gracefully (returns [])', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/return patterns|return \[\]/);
  });

  it('wraps per-habit work in try/catch', () => {
    const start = SRC.indexOf('export async function extractTimeOfDayPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL — neither helper nor extractor exported.

- [ ] **Step 3: Implement `hourHistogramWindow` + `extractTimeOfDayPatterns`**

Add `hourHistogramWindow` in the pure helpers section (after `isStableInterval`):

```typescript
/**
 * Compute peak hour and mass within ±windowSize hours.
 * Window wraps modulo 24. Returns peakHour=null for empty input.
 * Deterministic: ties broken by smaller hour.
 *
 * Used by extractTimeOfDayPatterns. Pure — no DB.
 */
export function hourHistogramWindow(
  hours: number[],
  windowSize = 2,
): { peakHour: number | null; pct: number } {
  if (hours.length === 0) return { peakHour: null, pct: 0 };
  const counts = new Array(24).fill(0) as number[];
  for (const h of hours) {
    const hh = ((h % 24) + 24) % 24;
    counts[Math.floor(hh)]++;
  }

  let bestHour = 0;
  let bestMass = -1;
  for (let h = 0; h < 24; h++) {
    let mass = 0;
    for (let d = -windowSize; d <= windowSize; d++) {
      mass += counts[((h + d) % 24 + 24) % 24];
    }
    if (mass > bestMass) {
      bestMass = mass;
      bestHour = h;
    }
  }
  return { peakHour: bestHour, pct: bestMass / hours.length };
}
```

Add the extractor at the bottom (after `extractFrequencyPatterns`):

```typescript
// ---------------------------------------------------------------------------
// Extractor: time_of_day
// ---------------------------------------------------------------------------

/**
 * For each Habit with >= 14 completed logs, compute hour-of-day histogram
 * over (a) HabitLog.date interpreted at the log-time hour if available,
 * (b) Memory events of type='habit_completed' with validAt as wall-clock.
 *
 * Mini-version note: HabitLog.date is @db.Date (no time component) — we
 * fall back to Memory rows where habit completion has a real timestamp.
 * If neither source yields meaningful hour variance, skip this habit.
 *
 * If >=70% of completions fall within ±2h window → Pattern{time_of_day}.
 * Best-effort: per-habit errors are caught.
 */
export async function extractTimeOfDayPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    select: { id: true, name: true },
  });

  if (habits.length === 0) return patterns;

  for (const habit of habits) {
    try {
      // Source: Memory rows tagged with habit id in entityRefs OR sourceId.
      const memRows = await prisma.memory.findMany({
        where: {
          userId,
          OR: [
            { entityRefs: { has: habit.id } },
            { sourceId: habit.id },
          ],
          type: { in: ['habit_completed', 'event'] },
        },
        select: { validAt: true },
      });

      const hours = memRows.map((r) => r.validAt.getHours());
      if (hours.length < 14) continue;

      const { peakHour, pct } = hourHistogramWindow(hours, 2);
      if (peakHour === null || pct < 0.7) continue;

      const observations = hours.length;
      const confidence = clampConfidence(observations);
      const payload = { habitId: habit.id, hourMode: peakHour, windowPct: pct };
      const description = `${habit.name} обычно в ${peakHour}:00 (±2ч)`;

      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'time_of_day', invalidAt: null },
      });

      let row: Pattern;
      if (
        existing &&
        (existing.payload as { habitId?: string })?.habitId === habit.id
      ) {
        row = await prisma.pattern.update({
          where: { id: existing.id },
          data: {
            description,
            payload,
            observations,
            confidence,
            lastObservedAt: new Date(),
          },
        });
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'time_of_day',
            description,
            payload,
            observations,
            confidence,
            lastObservedAt: new Date(),
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] time_of_day extract failed for habit',
        habit.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractTimeOfDayPatterns + hourHistogramWindow helper (B4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: `extractRecurringTopicPatterns` + `cosineSimilarity` + `greedyCluster` helpers

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- For each Entity with `importance >= 7`:
  - Compute baseline frequency: events involving entity / (active period in weeks). If `< 1/week` → skip.
  - Pull Memory rows where `entityRefs` includes entity AND `embedding IS NOT NULL` AND `validAt >= now - 90 days`. Read embedding via `$queryRawUnsafe` (Prisma `Unsupported('vector(512)')` doesn't surface natively).
  - Greedy cluster (cosine ≥ 0.75): for each new vec, find first existing cluster whose centroid cosine ≥ 0.75 — add to cluster (update centroid as running mean); else start new cluster.
  - Any cluster with `size >= 3` → Pattern `{ kind:'recurring_topic', payload:{ entityId, clusterCentroidPreview: first 8 dims, size, sampleContents: top 2 contents } }`.
  - `confidence = clampConfidence(cluster.size)`.

**Pure helpers:**
- `cosineSimilarity(a: number[], b: number[]): number` — standard cosine; returns 0 if either vector is zero-norm or lengths differ.
- `greedyCluster(vectors: number[][], threshold?: number): Array<{ memberIndexes: number[]; centroid: number[] }>` — pure, deterministic, threshold default 0.75.

- [ ] **Step 1: Write failing tests for `cosineSimilarity` + `greedyCluster` + structural tests**

Append to `procedural-memory.test.ts`:

```typescript
import { cosineSimilarity, greedyCluster } from './procedural-memory.js';

describe('cosineSimilarity — pure helper', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 if either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('returns 0 if lengths differ', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('handles normalized 3D vectors correctly', () => {
    expect(cosineSimilarity([3, 4, 0], [3, 4, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([3, 4, 0], [4, 3, 0])).toBeCloseTo(0.96, 2);
  });
});

describe('greedyCluster — pure helper', () => {
  it('returns no clusters for empty input', () => {
    expect(greedyCluster([])).toEqual([]);
  });

  it('places a single vector into one cluster', () => {
    const clusters = greedyCluster([[1, 0, 0]]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIndexes).toEqual([0]);
  });

  it('groups similar vectors into one cluster (cos >= 0.75)', () => {
    const clusters = greedyCluster([
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0.95, 0.05, 0],
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIndexes).toEqual([0, 1, 2]);
  });

  it('separates dissimilar vectors into different clusters', () => {
    const clusters = greedyCluster([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(clusters).toHaveLength(3);
  });

  it('respects custom threshold', () => {
    // [1,0] vs [0.7, 0.7]/sqrt(0.98)≈0.99 normalized cos ≈ 0.707
    // With threshold 0.6 should cluster, with 0.8 should split.
    const a = [1, 0];
    const b = [0.7071, 0.7071];
    expect(greedyCluster([a, b], 0.6)).toHaveLength(1);
    expect(greedyCluster([a, b], 0.8)).toHaveLength(2);
  });

  it('updates centroid as running mean', () => {
    const clusters = greedyCluster([
      [1, 0],
      [1, 0],
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].centroid[0]).toBeCloseTo(1, 5);
    expect(clusters[0].centroid[1]).toBeCloseTo(0, 5);
  });
});

describe('procedural-memory.ts structural — extractRecurringTopicPatterns', () => {
  it('exports extractRecurringTopicPatterns', () => {
    expect(SRC).toMatch(/export async function extractRecurringTopicPatterns/);
  });

  it('exports cosineSimilarity helper', () => {
    expect(SRC).toMatch(/export function cosineSimilarity/);
  });

  it('exports greedyCluster helper', () => {
    expect(SRC).toMatch(/export function greedyCluster/);
  });

  it('filters entities by importance >= 7', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('importance');
    expect(body).toContain('7');
  });

  it('uses $queryRawUnsafe to read embeddings (pgvector Unsupported)', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('$queryRawUnsafe');
    expect(body).toContain('embedding');
  });

  it('calls greedyCluster with cosine threshold ~0.75', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('greedyCluster(');
    expect(body).toContain('0.75');
  });

  it('requires cluster size >= 3 (spec §6.4)', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('>= 3');
  });

  it('creates Pattern with kind=recurring_topic', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain("'recurring_topic'");
  });

  it('wraps per-entity work in try/catch', () => {
    const start = SRC.indexOf('export async function extractRecurringTopicPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement helpers + extractor**

Add to pure helpers section:

```typescript
/**
 * Standard cosine similarity in [-1, 1]. Returns 0 if either vector
 * is zero or lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Greedy single-pass clustering over vectors with cosine threshold.
 * Deterministic: order-dependent (first cluster matched wins).
 * Centroid is running mean of members.
 *
 * Mini-version of k-means/HDBSCAN: faster, no convergence loop, fits
 * Phase A budget (<100 vectors per entity).
 */
export function greedyCluster(
  vectors: number[][],
  threshold = 0.75,
): Array<{ memberIndexes: number[]; centroid: number[] }> {
  const clusters: Array<{ memberIndexes: number[]; centroid: number[] }> = [];
  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    let placed = false;
    for (const c of clusters) {
      if (cosineSimilarity(c.centroid, vec) >= threshold) {
        // Add member and update centroid as running mean.
        c.memberIndexes.push(i);
        const n = c.memberIndexes.length;
        for (let d = 0; d < c.centroid.length; d++) {
          c.centroid[d] = c.centroid[d] + (vec[d] - c.centroid[d]) / n;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ memberIndexes: [i], centroid: [...vec] });
    }
  }
  return clusters;
}
```

Add extractor at bottom:

```typescript
// ---------------------------------------------------------------------------
// Extractor: recurring_topic (greedy cosine clustering)
// ---------------------------------------------------------------------------

type EmbRow = { id: string; content: string; validAt: Date; embedding: number[] | null };

/**
 * For each Entity with importance >= 7 and >1 event/week baseline, cluster
 * the entity's recent Memory.embedding rows with greedy cosine (threshold
 * 0.75). Any cluster of size >= 3 → Pattern{recurring_topic}.
 *
 * Mini-version: no k-means/HDBSCAN. Best-effort: per-entity errors caught.
 */
export async function extractRecurringTopicPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const entities = await prisma.entity.findMany({
    where: { userId, importance: { gte: 7 } },
    select: { id: true, name: true, createdAt: true },
  });

  if (entities.length === 0) return patterns;

  const cutoff = new Date(Date.now() - 90 * 86_400_000);

  for (const entity of entities) {
    try {
      // Baseline frequency check: events / weeks-active. Skip if < 1/week.
      const totalEvents = await prisma.memory.count({
        where: { userId, entityRefs: { has: entity.id } },
      });
      const weeksActive = Math.max(
        1,
        (Date.now() - entity.createdAt.getTime()) / (7 * 86_400_000),
      );
      if (totalEvents / weeksActive < 1) continue;

      // Pull embeddings via raw SQL (pgvector type is Unsupported in Prisma).
      const rows = await prisma.$queryRawUnsafe<EmbRow[]>(
        `SELECT id, content, "validAt", embedding::text AS embedding
         FROM "Memory"
         WHERE "userId" = $1
           AND $2 = ANY("entityRefs")
           AND "validAt" >= $3
           AND embedding IS NOT NULL
         ORDER BY "validAt" DESC
         LIMIT 100`,
        userId,
        entity.id,
        cutoff,
      );

      if (rows.length < 3) continue;

      const parsedVectors: number[][] = [];
      const meta: Array<{ id: string; content: string }> = [];
      for (const r of rows) {
        const raw = r.embedding as unknown as string | null;
        if (!raw || typeof raw !== 'string') continue;
        // pgvector text format: "[0.1,0.2,...]"
        try {
          const vec = raw
            .replace(/^\[/, '')
            .replace(/\]$/, '')
            .split(',')
            .map((s) => Number(s.trim()));
          if (vec.length === 0 || vec.some((v) => Number.isNaN(v))) continue;
          parsedVectors.push(vec);
          meta.push({ id: r.id, content: r.content });
        } catch {
          continue;
        }
      }

      if (parsedVectors.length < 3) continue;

      const clusters = greedyCluster(parsedVectors, 0.75);

      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        if (c.memberIndexes.length < 3) continue;

        const observations = c.memberIndexes.length;
        const confidence = clampConfidence(observations);
        const sampleContents = c.memberIndexes
          .slice(0, 2)
          .map((i) => meta[i].content.slice(0, 120));

        const payload = {
          entityId: entity.id,
          clusterIndex: ci,
          centroidPreview: c.centroid.slice(0, 8),
          size: observations,
          sampleContents,
        };
        const description = `повторяющаяся тема вокруг ${entity.name} (${observations} событий)`;

        const existing = await prisma.pattern.findFirst({
          where: { userId, kind: 'recurring_topic', invalidAt: null },
        });

        let row: Pattern;
        if (
          existing &&
          (existing.payload as { entityId?: string; clusterIndex?: number })?.entityId ===
            entity.id &&
          (existing.payload as { clusterIndex?: number })?.clusterIndex === ci
        ) {
          row = await prisma.pattern.update({
            where: { id: existing.id },
            data: {
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        } else {
          row = await prisma.pattern.create({
            data: {
              userId,
              kind: 'recurring_topic',
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        }
        patterns.push(row);
      }
    } catch (err) {
      console.warn(
        '[procedural] recurring_topic extract failed for entity',
        entity.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractRecurringTopicPatterns + greedy cosine clustering (cosineSimilarity, greedyCluster helpers) (B5)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: `extractCommitmentPatterns` (Claude haiku + `parseCommitmentResponse` helper)

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- Pull last 7-day `ChatMessage` rows where `role='user'` and `crisis=false`.
- Fast prefilter via regex (cheap): `/обещаю|буду|начну с|решил|с понедельника|с завтра/i`. Only Claude-call messages that match.
- For matched messages, call Claude haiku with a JSON-only system prompt to extract `{ what: string, dueAt: string|null }`. Best-effort; on parse/network error, skip.
- `parseCommitmentResponse(raw: string): { what: string; dueAt: Date | null } | null` — pure helper: strip code fences, parse JSON, validate `what` non-empty, parse `dueAt` ISO string → Date or null. Returns null on any failure (never throws).
- Upsert Pattern `{ kind:'commitment', payload:{ what, dueAt: iso|null, fulfilled: null, sourceMsgId } }`. Always single-row create per message (no dedupe — each commitment is distinct); confidence = 1.0 (extracted from explicit phrase).

- [ ] **Step 1: Write failing tests for `parseCommitmentResponse` helper + structural tests**

Append:

```typescript
import { parseCommitmentResponse, matchesCommitmentPhrase } from './procedural-memory.js';

describe('matchesCommitmentPhrase — pure helper', () => {
  it('returns true for "обещаю"', () => {
    expect(matchesCommitmentPhrase('обещаю прочитать книгу')).toBe(true);
  });

  it('returns true for "буду"', () => {
    expect(matchesCommitmentPhrase('буду ходить в зал')).toBe(true);
  });

  it('returns true for "с понедельника"', () => {
    expect(matchesCommitmentPhrase('с понедельника бросаю курить')).toBe(true);
  });

  it('returns true for "решил"', () => {
    expect(matchesCommitmentPhrase('решил пойти на йогу')).toBe(true);
  });

  it('returns false for random text', () => {
    expect(matchesCommitmentPhrase('погода сегодня хорошая')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(matchesCommitmentPhrase('')).toBe(false);
  });
});

describe('parseCommitmentResponse — pure helper', () => {
  it('parses valid JSON with what + dueAt', () => {
    const raw = JSON.stringify({ what: 'читать 30 мин в день', dueAt: '2026-06-01T00:00:00Z' });
    const result = parseCommitmentResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.what).toBe('читать 30 мин в день');
    expect(result!.dueAt).toBeInstanceOf(Date);
  });

  it('parses what without dueAt (null)', () => {
    const raw = JSON.stringify({ what: 'медитировать', dueAt: null });
    const result = parseCommitmentResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });

  it('strips markdown code fences', () => {
    const inner = JSON.stringify({ what: 'X', dueAt: null });
    const wrapped = '```json\n' + inner + '\n```';
    expect(parseCommitmentResponse(wrapped)).not.toBeNull();
  });

  it('returns null for invalid JSON (never throws)', () => {
    expect(parseCommitmentResponse('garbage')).toBeNull();
  });

  it('returns null for missing what field', () => {
    expect(parseCommitmentResponse(JSON.stringify({ dueAt: null }))).toBeNull();
  });

  it('returns null for empty what', () => {
    expect(parseCommitmentResponse(JSON.stringify({ what: '   ', dueAt: null }))).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCommitmentResponse('')).toBeNull();
  });

  it('handles invalid dueAt by setting dueAt to null', () => {
    const result = parseCommitmentResponse(
      JSON.stringify({ what: 'X', dueAt: 'not a date' }),
    );
    expect(result).not.toBeNull();
    expect(result!.dueAt).toBeNull();
  });
});

describe('procedural-memory.ts structural — extractCommitmentPatterns', () => {
  it('exports extractCommitmentPatterns', () => {
    expect(SRC).toMatch(/export async function extractCommitmentPatterns/);
  });

  it('exports matchesCommitmentPhrase pure helper', () => {
    expect(SRC).toMatch(/export function matchesCommitmentPhrase/);
  });

  it('exports parseCommitmentResponse pure helper', () => {
    expect(SRC).toMatch(/export function parseCommitmentResponse/);
  });

  it('queries last 7 days of ChatMessage', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('chatMessage');
    expect(body).toContain('7');
  });

  it('filters role=user and crisis=false', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'user'");
    expect(body).toContain('crisis');
  });

  it('uses matchesCommitmentPhrase prefilter before Claude call', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('matchesCommitmentPhrase(');
  });

  it('calls anthropic.messages.create with MODELS.haiku', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
    expect(body).toContain('MODELS.haiku');
  });

  it('uses parseCommitmentResponse to parse Claude output', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseCommitmentResponse(');
  });

  it('creates Pattern with kind=commitment', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("'commitment'");
  });

  it('wraps Claude call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function extractCommitmentPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL — helpers and extractor missing.

- [ ] **Step 3: Implement helpers + extractor**

Add to the imports block (top of file):

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../lib/models.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });
```

Add pure helpers (after `greedyCluster`):

```typescript
const COMMITMENT_PHRASES =
  /(обещ[аю]|^|\s)(буду|начн[ёе]?\w*\s+с|решил[аи]?|с\s+понедельника|с\s+завтра|с\s+нового\s+месяца)/i;

/**
 * Cheap regex prefilter for commitment phrases.
 * Mirrors emotional-classifier matchesEmotionalPhrase pattern.
 */
export function matchesCommitmentPhrase(text: string): boolean {
  if (!text) return false;
  if (/обещ[аю]/i.test(text)) return true;
  return COMMITMENT_PHRASES.test(text);
}

/**
 * Parse Claude haiku JSON response into { what, dueAt }.
 * Handles markdown code fences, invalid JSON, missing fields, bad dates.
 * Never throws — returns null on any failure.
 */
export function parseCommitmentResponse(
  raw: string,
): { what: string; dueAt: Date | null } | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text) as { what?: unknown; dueAt?: unknown };
    if (typeof parsed.what !== 'string') return null;
    const what = parsed.what.trim();
    if (!what) return null;
    let dueAt: Date | null = null;
    if (typeof parsed.dueAt === 'string' && parsed.dueAt.trim()) {
      const d = new Date(parsed.dueAt);
      if (!Number.isNaN(d.getTime())) dueAt = d;
    }
    return { what, dueAt };
  } catch {
    return null;
  }
}
```

Add extractor at bottom:

```typescript
// ---------------------------------------------------------------------------
// Extractor: commitment (Claude haiku, regex prefilter)
// ---------------------------------------------------------------------------

const COMMITMENT_SYSTEM_PROMPT = `Ты — аналитик намерений. Из сообщения извлеки ОДНО конкретное обязательство пользователя (что он обещает/решает делать) и срок если есть.

Верни ТОЛЬКО валидный JSON без markdown:
{ "what": "краткое описание обязательства", "dueAt": "ISO-8601 дата или null" }

Если обязательство не явное — верни { "what": "", "dueAt": null }.
НЕ добавляй объяснений, только JSON.`;

export async function extractCommitmentPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const messages = await prisma.chatMessage.findMany({
    where: {
      userId,
      role: 'user',
      crisis: false,
      createdAt: { gte: cutoff },
    },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length === 0) return patterns;

  for (const msg of messages) {
    if (!matchesCommitmentPhrase(msg.content)) continue;

    try {
      const resp = await anthropic.messages.create({
        model: MODELS.haiku,
        max_tokens: 256,
        system: COMMITMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: msg.content.slice(0, 1000) }],
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') continue;

      const parsed = parseCommitmentResponse(block.text);
      if (!parsed) continue;

      const payload = {
        what: parsed.what,
        dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
        fulfilled: null,
        sourceMsgId: msg.id,
      };
      const description = `обязательство: ${parsed.what}`;

      // Idempotent on sourceMsgId — same message shouldn't create duplicate.
      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'commitment', invalidAt: null },
      });
      let row: Pattern;
      if (
        existing &&
        (existing.payload as { sourceMsgId?: string })?.sourceMsgId === msg.id
      ) {
        row = existing;
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'commitment',
            description,
            payload,
            observations: 1,
            confidence: 1.0,
            lastObservedAt: msg.createdAt,
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] commitment extract failed for msg',
        msg.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractCommitmentPatterns — Claude haiku + matchesCommitmentPhrase + parseCommitmentResponse (B6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: `extractStreakBreakPatterns` + `weekIndex` helper

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`

**Logic:**
- For each Habit with `HabitLog` history >= 42 logs (~6 weeks):
  - Group logs by `weekIndex(habit.createdAt, log.date)` — index = floor(days_since_habit_created / 7) + 1.
  - For each week, compute `completionRate = completed / expectedPerWeek` (we use `completed/total_logs_that_week` as the mini proxy since `Habit.frequency` semantics vary).
  - Find weeks with `rate < 0.3` that immediately follow a streak (any prior week ≥ 0.8).
  - If the same `weekIndex` is a "break" in ≥ 2 separate streaks of the same habit → upsert Pattern `{ kind:'streak_break', payload:{ habitId, weekNumber, observedAt } }`.

**Pure helpers:**
- `weekIndex(startDate: Date, date: Date): number` — floor((date - startDate) / 7d) + 1; returns 1 for first week.

- [ ] **Step 1: Write failing tests for `weekIndex` + structural tests**

Append:

```typescript
import { weekIndex } from './procedural-memory.js';

describe('weekIndex — pure helper', () => {
  it('returns 1 for date equal to startDate', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(weekIndex(start, start)).toBe(1);
  });

  it('returns 1 for date 6 days after start', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-07T00:00:00Z'); // exactly 6 days
    expect(weekIndex(start, d)).toBe(1);
  });

  it('returns 2 for date 7 days after start', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-08T00:00:00Z');
    expect(weekIndex(start, d)).toBe(2);
  });

  it('returns 3 for date ~14 days after start', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const d = new Date('2026-01-15T00:00:00Z');
    expect(weekIndex(start, d)).toBe(3);
  });

  it('returns 1 for date before startDate (clamped)', () => {
    const start = new Date('2026-01-15T00:00:00Z');
    const d = new Date('2026-01-01T00:00:00Z');
    expect(weekIndex(start, d)).toBe(1);
  });
});

describe('procedural-memory.ts structural — extractStreakBreakPatterns', () => {
  it('exports extractStreakBreakPatterns', () => {
    expect(SRC).toMatch(/export async function extractStreakBreakPatterns/);
  });

  it('exports weekIndex helper', () => {
    expect(SRC).toMatch(/export function weekIndex/);
  });

  it('requires habits with >= 42 logs (6 weeks)', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('42');
  });

  it('uses weekIndex helper to bucket logs', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('weekIndex(');
  });

  it('checks completion rate < 0.3 (break threshold)', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('0.3');
  });

  it('requires same week appears as break >= 2 times', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('>= 2');
  });

  it('creates Pattern with kind=streak_break', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain("'streak_break'");
  });

  it('wraps per-habit work in try/catch', () => {
    const start = SRC.indexOf('export async function extractStreakBreakPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `weekIndex` + `extractStreakBreakPatterns`**

Add to pure helpers:

```typescript
/**
 * Index a date into a 1-based week number relative to startDate.
 * Week 1 = startDate .. startDate+6d. Clamps to 1 for dates < startDate.
 */
export function weekIndex(startDate: Date, date: Date): number {
  const ms = date.getTime() - startDate.getTime();
  if (ms < 0) return 1;
  return Math.floor(ms / (7 * 86_400_000)) + 1;
}
```

Add extractor at bottom:

```typescript
// ---------------------------------------------------------------------------
// Extractor: streak_break
// ---------------------------------------------------------------------------

/**
 * For each Habit with >= 42 logs (6 weeks), bucket logs by week index.
 * Find weeks where completion rate < 30% that immediately followed a
 * streak week (>= 80%). If same week-of-streak repeats as break >= 2
 * times → Pattern{streak_break}.
 *
 * Best-effort: per-habit errors caught.
 */
export async function extractStreakBreakPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    select: { id: true, name: true, createdAt: true },
  });

  if (habits.length === 0) return patterns;

  for (const habit of habits) {
    try {
      const logs = await prisma.habitLog.findMany({
        where: { habitId: habit.id, userId },
        select: { date: true, completed: true },
        orderBy: { date: 'asc' },
      });

      if (logs.length < 42) continue;

      // Bucket by week index. weekStats[wi] = { total, completed }
      const weekStats = new Map<number, { total: number; completed: number }>();
      for (const log of logs) {
        const wi = weekIndex(habit.createdAt, log.date);
        const entry = weekStats.get(wi) ?? { total: 0, completed: 0 };
        entry.total++;
        if (log.completed) entry.completed++;
        weekStats.set(wi, entry);
      }

      // Sort weeks ascending; find break weeks that follow streak weeks.
      const sortedWeeks = [...weekStats.entries()].sort((a, b) => a[0] - b[0]);
      const breakOccurrencesByWeek = new Map<number, number>();
      for (let i = 1; i < sortedWeeks.length; i++) {
        const [, prev] = sortedWeeks[i - 1];
        const [wi, curr] = sortedWeeks[i];
        const prevRate = prev.total === 0 ? 0 : prev.completed / prev.total;
        const currRate = curr.total === 0 ? 0 : curr.completed / curr.total;
        if (prevRate >= 0.8 && currRate < 0.3) {
          breakOccurrencesByWeek.set(wi, (breakOccurrencesByWeek.get(wi) ?? 0) + 1);
        }
      }

      for (const [wi, count] of breakOccurrencesByWeek.entries()) {
        if (count < 2) continue; // need >= 2 same-week breaks

        const observations = count;
        const confidence = clampConfidence(observations * 5); // 2 breaks → 1.0
        const payload = {
          habitId: habit.id,
          weekNumber: wi,
          observedAt: new Date().toISOString(),
        };
        const description = `${habit.name}: бросает на ${wi}-й неделе streak'а`;

        const existing = await prisma.pattern.findFirst({
          where: { userId, kind: 'streak_break', invalidAt: null },
        });
        let row: Pattern;
        if (
          existing &&
          (existing.payload as { habitId?: string; weekNumber?: number })?.habitId ===
            habit.id &&
          (existing.payload as { weekNumber?: number })?.weekNumber === wi
        ) {
          row = await prisma.pattern.update({
            where: { id: existing.id },
            data: {
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        } else {
          row = await prisma.pattern.create({
            data: {
              userId,
              kind: 'streak_break',
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        }
        patterns.push(row);
      }
    } catch (err) {
      console.warn(
        '[procedural] streak_break extract failed for habit',
        habit.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts
```

Expected: helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractStreakBreakPatterns + weekIndex helper (B7)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B8: `extractPatterns` orchestrator + dedupe + singleton wrap

**Files:**
- Modify: `packages/server/src/services/procedural-memory.ts`
- Modify: `packages/server/src/services/procedural-memory.test.ts`
- Create: `packages/server/src/services/procedural-memory.singleton.ts`
- Create: `packages/server/src/services/procedural-memory.singleton.test.ts`

**Logic:**
- `extractPatterns(userId)` calls all 5 extractors via `Promise.allSettled` (so one failure doesn't drop the rest), aggregates results, dedupes by `(kind, JSON.stringify(payload))` keeping the last (most-recent) — since extractors may have run upsert and returned the post-update row.
- Singleton: mirrors `entity-graph/index.ts` exactly.

- [ ] **Step 1: Add failing structural tests + create singleton tests**

Append to `procedural-memory.test.ts`:

```typescript
describe('procedural-memory.ts structural — extractPatterns orchestrator', () => {
  it('extractPatterns calls all 5 extractors', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('extractFrequencyPatterns');
    expect(body).toContain('extractTimeOfDayPatterns');
    expect(body).toContain('extractRecurringTopicPatterns');
    expect(body).toContain('extractCommitmentPatterns');
    expect(body).toContain('extractStreakBreakPatterns');
  });

  it('extractPatterns uses Promise.allSettled (resilient to per-extractor failure)', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('Promise.allSettled');
  });

  it('extractPatterns dedupes by (kind, JSON.stringify(payload))', () => {
    const start = SRC.indexOf('async extractPatterns');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('JSON.stringify');
  });
});
```

Create `packages/server/src/services/procedural-memory.singleton.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/procedural-memory.singleton.ts'),
  'utf-8',
);

describe('procedural-memory.singleton.ts structural', () => {
  it('exports getProceduralMemory accessor', () => {
    expect(SRC).toMatch(/export function getProceduralMemory/);
  });

  it('exports _resetProceduralMemoryForTests test helper', () => {
    expect(SRC).toMatch(/export function _resetProceduralMemoryForTests/);
  });

  it('returns same instance on subsequent calls', async () => {
    const { getProceduralMemory, _resetProceduralMemoryForTests } = await import(
      './procedural-memory.singleton.js'
    );
    _resetProceduralMemoryForTests();
    const a = getProceduralMemory();
    const b = getProceduralMemory();
    expect(a).toBe(b);
  });

  it('_resetProceduralMemoryForTests yields fresh instance', async () => {
    const { getProceduralMemory, _resetProceduralMemoryForTests } = await import(
      './procedural-memory.singleton.js'
    );
    _resetProceduralMemoryForTests();
    const a = getProceduralMemory();
    _resetProceduralMemoryForTests();
    const b = getProceduralMemory();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts src/services/procedural-memory.singleton.test.ts
```

Expected: FAIL — `extractPatterns` placeholder throws; singleton file missing.

- [ ] **Step 3: Implement `extractPatterns` (replace placeholder) + create singleton**

Replace the `extractPatterns` placeholder in `procedural-memory.ts`:

```typescript
  async extractPatterns(userId: string): Promise<Pattern[]> {
    const results = await Promise.allSettled([
      extractFrequencyPatterns(userId),
      extractTimeOfDayPatterns(userId),
      extractRecurringTopicPatterns(userId),
      extractCommitmentPatterns(userId),
      extractStreakBreakPatterns(userId),
    ]);

    const aggregated: Pattern[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        aggregated.push(...r.value);
      } else {
        console.warn('[procedural] extractor failed:', r.reason);
      }
    }

    // Dedupe by (kind, JSON.stringify(payload)) — last wins.
    const dedup = new Map<string, Pattern>();
    for (const p of aggregated) {
      const key = `${p.kind}::${JSON.stringify(p.payload)}`;
      dedup.set(key, p);
    }
    return [...dedup.values()];
  }
```

Create `packages/server/src/services/procedural-memory.singleton.ts`:

```typescript
/**
 * v2.0 Tier 4 — singleton accessor for ProceduralMemory.
 *
 * Pattern mirrors entity-graph/index.ts (Week 3) and working-memory.ts.
 * Wired into jarvis-orchestrator in Week 5.
 */

import { ProceduralMemory } from './procedural-memory.js';
import type { ProceduralMemoryStore } from './procedural-memory.js';

let _instance: ProceduralMemoryStore | null = null;

export function getProceduralMemory(): ProceduralMemoryStore {
  if (!_instance) {
    _instance = new ProceduralMemory();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files.
 */
export function _resetProceduralMemoryForTests(): void {
  _instance = null;
}
```

Also add `export type { ProceduralMemoryStore } from './procedural-memory.js';` if not already exported as type — but interface is already `export interface ProceduralMemoryStore` in B1, so importing directly works.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/procedural-memory.test.ts src/services/procedural-memory.singleton.test.ts
```

Expected: all PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/procedural-memory.test.ts \
       packages/server/src/services/procedural-memory.singleton.test.ts
```

Expected: `0` total.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/procedural-memory.ts \
        packages/server/src/services/procedural-memory.test.ts \
        packages/server/src/services/procedural-memory.singleton.ts \
        packages/server/src/services/procedural-memory.singleton.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-procedural): extractPatterns orchestrator + Promise.allSettled + dedupe + singleton (B8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section C — EmotionalMemory (3 tasks)

### Task C1: Class skeleton + pure helpers + `analyzeMessage`

**Files:**
- Create: `packages/server/src/services/emotional-memory.ts`
- Create: `packages/server/src/services/emotional-memory.test.ts`

**Pure helpers to export:**
- `clampValence(v: number): number` — clamp to `[-1, 1]`
- `clampArousal(a: number): number` — clamp to `[0, 1]`
- `normalizeEmotionLabel(raw: string): 'sad'|'anxious'|'happy'|'angry'|'neutral'|'mixed'` — case-insensitive, anything unknown → `'neutral'`
- `parseMoodResponse(raw: string): { valence: number; arousal: number; emotion: string }` — strip code fences, parse JSON, clamp/normalize, return safe default `{valence:0, arousal:0.5, emotion:'neutral'}` on any failure (never throws)

**`analyzeMessage`:**
- Calls Claude haiku with a JSON-only system prompt
- Best-effort: errors → fallback `{valence:0, arousal:0.5, emotion:'neutral'}` (never throws)
- Writes a `MoodSnapshot` row with `source='message'`, `sourceId=msgId`, `excerpt=content.slice(0,200)`
- Returns the `MoodSnapshot` Prisma row

- [ ] **Step 1: Write failing tests for pure helpers + structural skeleton**

Create `packages/server/src/services/emotional-memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  clampValence,
  clampArousal,
  normalizeEmotionLabel,
  parseMoodResponse,
} from './emotional-memory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('clampValence — pure helper', () => {
  it('passes through values in [-1, 1]', () => {
    expect(clampValence(0)).toBe(0);
    expect(clampValence(-1)).toBe(-1);
    expect(clampValence(1)).toBe(1);
    expect(clampValence(0.5)).toBe(0.5);
  });

  it('clamps below -1 to -1', () => {
    expect(clampValence(-2)).toBe(-1);
    expect(clampValence(-100)).toBe(-1);
  });

  it('clamps above 1 to 1', () => {
    expect(clampValence(2)).toBe(1);
    expect(clampValence(100)).toBe(1);
  });

  it('returns 0 for NaN (safe default)', () => {
    expect(clampValence(Number.NaN)).toBe(0);
  });
});

describe('clampArousal — pure helper', () => {
  it('passes through values in [0, 1]', () => {
    expect(clampArousal(0)).toBe(0);
    expect(clampArousal(1)).toBe(1);
    expect(clampArousal(0.5)).toBe(0.5);
  });

  it('clamps below 0 to 0', () => {
    expect(clampArousal(-0.5)).toBe(0);
  });

  it('clamps above 1 to 1', () => {
    expect(clampArousal(2)).toBe(1);
  });

  it('returns 0.5 for NaN', () => {
    expect(clampArousal(Number.NaN)).toBe(0.5);
  });
});

describe('normalizeEmotionLabel — pure helper', () => {
  it('passes through known labels case-insensitively', () => {
    expect(normalizeEmotionLabel('sad')).toBe('sad');
    expect(normalizeEmotionLabel('SAD')).toBe('sad');
    expect(normalizeEmotionLabel('Happy')).toBe('happy');
    expect(normalizeEmotionLabel('anxious')).toBe('anxious');
    expect(normalizeEmotionLabel('angry')).toBe('angry');
    expect(normalizeEmotionLabel('neutral')).toBe('neutral');
    expect(normalizeEmotionLabel('mixed')).toBe('mixed');
  });

  it('maps unknown labels to neutral', () => {
    expect(normalizeEmotionLabel('confused')).toBe('neutral');
    expect(normalizeEmotionLabel('')).toBe('neutral');
    expect(normalizeEmotionLabel('грустно')).toBe('neutral');
  });
});

describe('parseMoodResponse — pure helper', () => {
  it('parses valid JSON', () => {
    const raw = JSON.stringify({ valence: -0.5, arousal: 0.7, emotion: 'sad' });
    expect(parseMoodResponse(raw)).toEqual({ valence: -0.5, arousal: 0.7, emotion: 'sad' });
  });

  it('strips markdown code fences', () => {
    const inner = JSON.stringify({ valence: 0.3, arousal: 0.5, emotion: 'happy' });
    const wrapped = '```json\n' + inner + '\n```';
    expect(parseMoodResponse(wrapped).emotion).toBe('happy');
  });

  it('returns safe default for invalid JSON', () => {
    expect(parseMoodResponse('garbage')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });

  it('returns safe default for empty', () => {
    expect(parseMoodResponse('')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });

  it('clamps out-of-range valence and arousal', () => {
    const raw = JSON.stringify({ valence: -5, arousal: 2, emotion: 'sad' });
    expect(parseMoodResponse(raw)).toEqual({ valence: -1, arousal: 1, emotion: 'sad' });
  });

  it('normalizes unknown emotion to neutral', () => {
    const raw = JSON.stringify({ valence: 0, arousal: 0.5, emotion: 'whatever' });
    expect(parseMoodResponse(raw).emotion).toBe('neutral');
  });

  it('uses defaults for missing fields', () => {
    expect(parseMoodResponse('{}')).toEqual({
      valence: 0,
      arousal: 0.5,
      emotion: 'neutral',
    });
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/emotional-memory.ts'),
  'utf-8',
);

describe('emotional-memory.ts structural — skeleton + analyzeMessage', () => {
  it('exports EmotionalMemory class', () => {
    expect(SRC).toMatch(/export class EmotionalMemory/);
  });

  it('declares EmotionalMemoryStore interface', () => {
    expect(SRC).toMatch(/export interface EmotionalMemoryStore/);
  });

  it('class implements EmotionalMemoryStore', () => {
    expect(SRC).toMatch(/implements EmotionalMemoryStore/);
  });

  it('re-exports MoodSnapshot type', () => {
    expect(SRC).toMatch(/export type \{[^}]*MoodSnapshot[^}]*\}/);
  });

  it('exports clampValence, clampArousal, normalizeEmotionLabel, parseMoodResponse', () => {
    expect(SRC).toMatch(/export function clampValence/);
    expect(SRC).toMatch(/export function clampArousal/);
    expect(SRC).toMatch(/export function normalizeEmotionLabel/);
    expect(SRC).toMatch(/export function parseMoodResponse/);
  });

  it('analyzeMessage exported as async method', () => {
    expect(SRC).toMatch(/async analyzeMessage\s*\(/);
  });

  it('analyzeMessage calls anthropic.messages.create with MODELS.haiku', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('anthropic.messages.create');
    expect(body).toContain('MODELS.haiku');
  });

  it('analyzeMessage wraps Claude call in try/catch (best-effort)', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });

  it('analyzeMessage writes MoodSnapshot row', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('prisma.moodSnapshot.create');
  });

  it('analyzeMessage uses parseMoodResponse', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('parseMoodResponse(');
  });

  it('analyzeMessage falls back to neutral on error (never throws)', () => {
    const start = SRC.indexOf('async analyzeMessage');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain("emotion: 'neutral'");
  });

  it('system prompt instructs JSON-only output', () => {
    expect(SRC).toMatch(/ТОЛЬКО.*JSON|ONLY.*JSON|valid JSON/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts
```

Expected: FAIL — file missing.

- [ ] **Step 3: Create `emotional-memory.ts`**

Create `packages/server/src/services/emotional-memory.ts`:

```typescript
/**
 * v2.0 Tier 5 — EmotionalMemory: structured mood per message + timeline.
 *
 * NEW module — does NOT replace existing emotional-classifier.ts
 * (binary phrase-net for therapeutic routing). This module extracts a
 * structured {valence, arousal, emotion} JSON via Claude haiku and writes
 * MoodSnapshot rows for timeline analytics + entity-mood + shift detection.
 *
 * Pattern mirrors episodic-memory.ts:
 *   - Pure helpers exported for unit testing without DB/Claude
 *   - Async service methods on a class implementing EmotionalMemoryStore
 *   - Singleton accessor in separate file
 *
 * Best-effort throughout: Claude failures yield safe default
 * { valence: 0, arousal: 0.5, emotion: 'neutral' } and never throw.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import type { MoodSnapshot } from '@prisma/client';

export type { MoodSnapshot };

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmotionalMemoryStore {
  analyzeMessage(userId: string, msgId: string, content: string): Promise<MoodSnapshot>;
  getMoodTimeline(
    userId: string,
    sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>>;
  getEntityMood(userId: string, entityId: string): Promise<number>;
  detectMoodShift(userId: string): Promise<{
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB/Claude)
// ---------------------------------------------------------------------------

const KNOWN_EMOTIONS = new Set([
  'sad', 'anxious', 'happy', 'angry', 'neutral', 'mixed',
]);

export function clampValence(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export function clampArousal(a: number): number {
  if (Number.isNaN(a)) return 0.5;
  return Math.max(0, Math.min(1, a));
}

export function normalizeEmotionLabel(
  raw: string,
): 'sad' | 'anxious' | 'happy' | 'angry' | 'neutral' | 'mixed' {
  if (!raw || typeof raw !== 'string') return 'neutral';
  const lower = raw.trim().toLowerCase();
  return (KNOWN_EMOTIONS.has(lower) ? lower : 'neutral') as
    | 'sad' | 'anxious' | 'happy' | 'angry' | 'neutral' | 'mixed';
}

/**
 * Parse Claude mood response. Never throws — safe default on any failure:
 *   { valence: 0, arousal: 0.5, emotion: 'neutral' }
 */
export function parseMoodResponse(
  raw: string,
): { valence: number; arousal: number; emotion: string } {
  const safe = { valence: 0, arousal: 0.5, emotion: 'neutral' };
  if (!raw || !raw.trim()) return safe;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text) as {
      valence?: unknown;
      arousal?: unknown;
      emotion?: unknown;
    };
    const valence =
      typeof parsed.valence === 'number' ? clampValence(parsed.valence) : 0;
    const arousal =
      typeof parsed.arousal === 'number' ? clampArousal(parsed.arousal) : 0.5;
    const emotion = normalizeEmotionLabel(
      typeof parsed.emotion === 'string' ? parsed.emotion : 'neutral',
    );
    return { valence, arousal, emotion };
  } catch {
    return safe;
  }
}

// ---------------------------------------------------------------------------
// EmotionalMemory implementation
// ---------------------------------------------------------------------------

const MOOD_SYSTEM_PROMPT = `Ты — анализатор эмоций. Прочитай сообщение пользователя и оцени:
- valence: -1..+1 (негативная — позитивная окраска)
- arousal: 0..1 (спокойствие — возбуждение)
- emotion: одно из 'sad'|'anxious'|'happy'|'angry'|'neutral'|'mixed'

Верни ТОЛЬКО валидный JSON без markdown:
{ "valence": 0.0, "arousal": 0.5, "emotion": "neutral" }

НЕ добавляй объяснений.`;

export class EmotionalMemory implements EmotionalMemoryStore {
  async analyzeMessage(
    userId: string,
    msgId: string,
    content: string,
  ): Promise<MoodSnapshot> {
    let parsed = { valence: 0, arousal: 0.5, emotion: 'neutral' };

    try {
      const resp = await anthropic.messages.create({
        model: MODELS.haiku,
        max_tokens: 128,
        system: MOOD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content.slice(0, 1000) }],
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (block && block.type === 'text') {
        parsed = parseMoodResponse(block.text);
      }
    } catch (err) {
      console.warn(
        '[emotional-memory] analyzeMessage Claude failed (fallback to neutral):',
        err instanceof Error ? err.message : err,
      );
      // parsed stays at safe default
    }

    return prisma.moodSnapshot.create({
      data: {
        userId,
        source: 'message',
        sourceId: msgId,
        valence: parsed.valence,
        arousal: parsed.arousal,
        emotion: parsed.emotion,
        entityRefs: [],
        excerpt: content.slice(0, 200),
      },
    });
  }

  async getMoodTimeline(
    _userId: string,
    _sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>> {
    throw new Error('getMoodTimeline not yet implemented — Task C2');
  }

  async getEntityMood(_userId: string, _entityId: string): Promise<number> {
    throw new Error('getEntityMood not yet implemented — Task C2');
  }

  async detectMoodShift(_userId: string): Promise<{
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null> {
    throw new Error('detectMoodShift not yet implemented — Task C3');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts
```

Expected: all helper unit tests + structural tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/emotional-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Confirm existing emotional-classifier.ts is unchanged**

```bash
git diff --stat packages/server/src/services/emotional-classifier.ts
```

Expected: empty (no modifications).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/emotional-memory.ts \
        packages/server/src/services/emotional-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-emotional): EmotionalMemory skeleton + pure helpers (clampValence/clampArousal/normalizeEmotionLabel/parseMoodResponse) + analyzeMessage Claude haiku (C1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `getMoodTimeline` + `getEntityMood` + `groupByDay` helper

**Files:**
- Modify: `packages/server/src/services/emotional-memory.ts`
- Modify: `packages/server/src/services/emotional-memory.test.ts`

**Logic:**
- `groupByDay`: pure helper. Given `Array<{ recordedAt: Date; valence: number; emotion: string }>`, group into `Map<YYYY-MM-DD, { valences: number[]; emotions: string[] }>`. For each day return `{ date, valence: avg, emotion: dominant_emotion }`.
- `dominantEmotion(list: string[]): string` — mode (most common); ties broken alphabetically for determinism.
- `getMoodTimeline`: query `MoodSnapshot` where `source='message'` and `recordedAt >= now - sinceDays`. Apply `groupByDay`. Return sorted ascending by date.
- `getEntityMood`: query `MoodSnapshot` where `entityRefs` contains `entityId`. Return average `valence`. If no rows → `0`.

- [ ] **Step 1: Add failing tests**

Append:

```typescript
import { groupByDay, dominantEmotion } from './emotional-memory.js';

describe('dominantEmotion — pure helper', () => {
  it('returns mode for clear majority', () => {
    expect(dominantEmotion(['sad', 'sad', 'happy'])).toBe('sad');
  });

  it('returns "neutral" for empty', () => {
    expect(dominantEmotion([])).toBe('neutral');
  });

  it('breaks ties alphabetically (deterministic)', () => {
    expect(dominantEmotion(['happy', 'sad'])).toBe('happy'); // 'h' < 's'
  });
});

describe('groupByDay — pure helper', () => {
  it('returns empty array for empty input', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('groups two snapshots same day, avg valence, dominant emotion', () => {
    const snaps = [
      { recordedAt: new Date('2026-05-29T10:00:00Z'), valence: 0.4, emotion: 'happy' },
      { recordedAt: new Date('2026-05-29T20:00:00Z'), valence: 0.6, emotion: 'happy' },
    ];
    const result = groupByDay(snaps);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-05-29');
    expect(result[0].valence).toBeCloseTo(0.5, 2);
    expect(result[0].emotion).toBe('happy');
  });

  it('returns days sorted ascending', () => {
    const snaps = [
      { recordedAt: new Date('2026-05-30T10:00:00Z'), valence: 0.2, emotion: 'happy' },
      { recordedAt: new Date('2026-05-29T10:00:00Z'), valence: -0.2, emotion: 'sad' },
    ];
    const result = groupByDay(snaps);
    expect(result[0].date).toBe('2026-05-29');
    expect(result[1].date).toBe('2026-05-30');
  });
});

describe('emotional-memory.ts structural — getMoodTimeline / getEntityMood', () => {
  it('exports groupByDay helper', () => {
    expect(SRC).toMatch(/export function groupByDay/);
  });

  it('exports dominantEmotion helper', () => {
    expect(SRC).toMatch(/export function dominantEmotion/);
  });

  it('getMoodTimeline queries MoodSnapshot.findMany', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.moodSnapshot.findMany');
  });

  it('getMoodTimeline filters source=message', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain("'message'");
  });

  it('getMoodTimeline calls groupByDay', () => {
    const start = SRC.indexOf('async getMoodTimeline');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('groupByDay(');
  });

  it('getEntityMood filters entityRefs has entityId', () => {
    const start = SRC.indexOf('async getEntityMood');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('entityRefs');
    expect(body).toContain('has:');
  });

  it('getEntityMood returns 0 if no rows', () => {
    const start = SRC.indexOf('async getEntityMood');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/return 0|=== 0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement helpers + methods**

Add to pure helpers section (after `parseMoodResponse`):

```typescript
/**
 * Return the most common string in `list`. Ties broken alphabetically.
 * Empty list → 'neutral'.
 */
export function dominantEmotion(list: string[]): string {
  if (list.length === 0) return 'neutral';
  const counts = new Map<string, number>();
  for (const e of list) counts.set(e, (counts.get(e) ?? 0) + 1);
  let best = '';
  let bestCount = -1;
  for (const [emo, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = emo;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Group mood snapshots by UTC day. For each day returns avg valence
 * and dominant emotion. Result sorted ascending by date.
 */
export function groupByDay(
  snaps: Array<{ recordedAt: Date; valence: number; emotion: string }>,
): Array<{ date: string; valence: number; emotion: string }> {
  if (snaps.length === 0) return [];
  const byDay = new Map<string, { valences: number[]; emotions: string[] }>();
  for (const s of snaps) {
    const key = s.recordedAt.toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { valences: [], emotions: [] };
    entry.valences.push(s.valence);
    entry.emotions.push(s.emotion);
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { valences, emotions }]) => ({
      date,
      valence: valences.reduce((s, v) => s + v, 0) / valences.length,
      emotion: dominantEmotion(emotions),
    }));
}
```

Replace placeholder methods:

```typescript
  async getMoodTimeline(
    userId: string,
    sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>> {
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
    const rows = await prisma.moodSnapshot.findMany({
      where: { userId, source: 'message', recordedAt: { gte: cutoff } },
      select: { recordedAt: true, valence: true, emotion: true },
      orderBy: { recordedAt: 'asc' },
    });
    return groupByDay(rows);
  }

  async getEntityMood(userId: string, entityId: string): Promise<number> {
    const rows = await prisma.moodSnapshot.findMany({
      where: { userId, entityRefs: { has: entityId } },
      select: { valence: true },
    });
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.valence, 0) / rows.length;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts
```

Expected: all PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/emotional-memory.test.ts
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/emotional-memory.ts \
        packages/server/src/services/emotional-memory.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-emotional): getMoodTimeline + getEntityMood + groupByDay + dominantEmotion helpers (C2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: `detectMoodShift` + `computeShiftMagnitude` helper + singleton wrap

**Files:**
- Modify: `packages/server/src/services/emotional-memory.ts`
- Modify: `packages/server/src/services/emotional-memory.test.ts`
- Create: `packages/server/src/services/emotional-memory.singleton.ts`
- Create: `packages/server/src/services/emotional-memory.singleton.test.ts`

**Logic:**
- `computeShiftMagnitude(recent: number[], baseline: number[]): { magnitude: number; direction: 'up'|'down'|null }` — pure.
  - `recentAvg = mean(recent)`, `baselineAvg = mean(baseline)`, `baselineSd = stddev(baseline)` (use existing `stddev` import or local — to keep modules independent we declare a local copy of stddev OR import via a relative trick. To avoid cross-module helper duplication, **redefine** `stddev` locally as `_stddev` private within emotional-memory.ts — both modules are independent and the test-pattern compliance forbids cross-module test entanglement).
  - If `baseline.length < 2` or `baselineSd === 0` → magnitude = `Math.abs(recentAvg - baselineAvg)`, direction by sign of diff if any.
  - Else `magnitude = |recentAvg - baselineAvg| / baselineSd`.
  - direction = `'up'` if recentAvg > baselineAvg, `'down'` if <, `null` if equal.
- `detectMoodShift`: pull last 17 days of `message`-source snapshots; split last 3d vs prior 14d; compute magnitude; if `magnitude >= 1.0` → shifted true with `sinceDays=3`; else `{ shifted: false }`. If insufficient data (< 3 snapshots in recent window or < 5 in baseline) → return `null` (caller can decide).

- [ ] **Step 1: Add failing tests for `computeShiftMagnitude` + structural for `detectMoodShift` + singleton structural**

Append to `emotional-memory.test.ts`:

```typescript
import { computeShiftMagnitude } from './emotional-memory.js';

describe('computeShiftMagnitude — pure helper', () => {
  it('returns magnitude 0 and direction null for identical avgs', () => {
    const r = computeShiftMagnitude([0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(r.magnitude).toBe(0);
    expect(r.direction).toBeNull();
  });

  it('returns positive magnitude for upward shift', () => {
    const r = computeShiftMagnitude([0.8, 0.9], [0.1, 0.2, 0.0, 0.1, 0.0]);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.direction).toBe('up');
  });

  it('returns positive magnitude for downward shift with direction down', () => {
    const r = computeShiftMagnitude([-0.8, -0.9], [0.1, 0.2, 0.0, 0.1, 0.0]);
    expect(r.magnitude).toBeGreaterThan(0);
    expect(r.direction).toBe('down');
  });

  it('handles zero baseline stddev (all same) by raw diff', () => {
    const r = computeShiftMagnitude([1.0], [0.5, 0.5, 0.5]);
    expect(r.magnitude).toBeCloseTo(0.5, 5);
    expect(r.direction).toBe('up');
  });

  it('handles small baseline (< 2) by raw diff', () => {
    const r = computeShiftMagnitude([0.5], [0.0]);
    expect(r.magnitude).toBeCloseTo(0.5, 5);
    expect(r.direction).toBe('up');
  });

  it('handles empty recent (magnitude 0, direction null)', () => {
    const r = computeShiftMagnitude([], [0.1, 0.2]);
    expect(r.magnitude).toBe(0);
    expect(r.direction).toBeNull();
  });
});

describe('emotional-memory.ts structural — detectMoodShift', () => {
  it('exports computeShiftMagnitude helper', () => {
    expect(SRC).toMatch(/export function computeShiftMagnitude/);
  });

  it('detectMoodShift queries last ~17 days of snapshots', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toMatch(/17|14[\s\S]*?3/);
  });

  it('detectMoodShift uses computeShiftMagnitude', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('computeShiftMagnitude(');
  });

  it('detectMoodShift checks magnitude >= 1.0 threshold', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('1.0');
  });

  it('detectMoodShift returns null on insufficient data', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('return null');
  });

  it('detectMoodShift returns { shifted: true, direction, magnitude, sinceDays: 3 } when shifted', () => {
    const start = SRC.indexOf('async detectMoodShift');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('shifted: true');
    expect(body).toContain('sinceDays: 3');
  });
});
```

Create `packages/server/src/services/emotional-memory.singleton.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/emotional-memory.singleton.ts'),
  'utf-8',
);

describe('emotional-memory.singleton.ts structural', () => {
  it('exports getEmotionalMemory accessor', () => {
    expect(SRC).toMatch(/export function getEmotionalMemory/);
  });

  it('exports _resetEmotionalMemoryForTests', () => {
    expect(SRC).toMatch(/export function _resetEmotionalMemoryForTests/);
  });

  it('singleton returns same instance', async () => {
    const { getEmotionalMemory, _resetEmotionalMemoryForTests } = await import(
      './emotional-memory.singleton.js'
    );
    _resetEmotionalMemoryForTests();
    expect(getEmotionalMemory()).toBe(getEmotionalMemory());
  });

  it('_resetEmotionalMemoryForTests yields fresh instance', async () => {
    const { getEmotionalMemory, _resetEmotionalMemoryForTests } = await import(
      './emotional-memory.singleton.js'
    );
    _resetEmotionalMemoryForTests();
    const a = getEmotionalMemory();
    _resetEmotionalMemoryForTests();
    const b = getEmotionalMemory();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts src/services/emotional-memory.singleton.test.ts
```

Expected: FAIL — `computeShiftMagnitude` not exported, singleton missing.

- [ ] **Step 3: Implement helper + method + singleton**

Add to pure helpers section:

```typescript
/**
 * Private — local sample stddev so emotional-memory has no cross-module
 * helper dependency. Mirrors procedural-memory.stddev exactly.
 */
function _localStddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute magnitude of mood shift between recent and baseline windows.
 * magnitude = |recentAvg - baselineAvg| / baselineSd (or raw diff if sd=0
 * or baseline too small). direction = 'up'|'down'|null.
 */
export function computeShiftMagnitude(
  recent: number[],
  baseline: number[],
): { magnitude: number; direction: 'up' | 'down' | null } {
  if (recent.length === 0) return { magnitude: 0, direction: null };
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  if (baseline.length === 0) {
    if (recentAvg === 0) return { magnitude: 0, direction: null };
    return {
      magnitude: Math.abs(recentAvg),
      direction: recentAvg > 0 ? 'up' : 'down',
    };
  }
  const baselineAvg = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const diff = recentAvg - baselineAvg;
  if (diff === 0) return { magnitude: 0, direction: null };

  const sd = _localStddev(baseline);
  const magnitude = sd === 0 ? Math.abs(diff) : Math.abs(diff) / sd;
  return { magnitude, direction: diff > 0 ? 'up' : 'down' };
}
```

Replace `detectMoodShift` placeholder:

```typescript
  async detectMoodShift(userId: string): Promise<{
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null> {
    const now = Date.now();
    const recentCutoff = new Date(now - 3 * 86_400_000);
    const baselineCutoff = new Date(now - 17 * 86_400_000); // 14 prior + 3 recent
    const rows = await prisma.moodSnapshot.findMany({
      where: {
        userId,
        source: 'message',
        recordedAt: { gte: baselineCutoff },
      },
      select: { recordedAt: true, valence: true },
    });

    const recent = rows.filter((r) => r.recordedAt >= recentCutoff).map((r) => r.valence);
    const baseline = rows
      .filter((r) => r.recordedAt < recentCutoff)
      .map((r) => r.valence);

    if (recent.length < 3 || baseline.length < 5) return null;

    const { magnitude, direction } = computeShiftMagnitude(recent, baseline);

    if (magnitude >= 1.0 && direction) {
      return { shifted: true, direction, magnitude, sinceDays: 3 };
    }
    return { shifted: false };
  }
```

Create `packages/server/src/services/emotional-memory.singleton.ts`:

```typescript
/**
 * v2.0 Tier 5 — singleton accessor for EmotionalMemory.
 * Mirrors procedural-memory.singleton.ts pattern.
 */

import { EmotionalMemory } from './emotional-memory.js';
import type { EmotionalMemoryStore } from './emotional-memory.js';

let _instance: EmotionalMemoryStore | null = null;

export function getEmotionalMemory(): EmotionalMemoryStore {
  if (!_instance) {
    _instance = new EmotionalMemory();
  }
  return _instance;
}

export function _resetEmotionalMemoryForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/emotional-memory.test.ts src/services/emotional-memory.singleton.test.ts
```

Expected: all PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/emotional-memory.test.ts \
       packages/server/src/services/emotional-memory.singleton.test.ts
```

Expected: `0`.

- [ ] **Step 7: Confirm `emotional-classifier.ts` still unmodified**

```bash
git diff --stat packages/server/src/services/emotional-classifier.ts
```

Expected: empty.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/emotional-memory.ts \
        packages/server/src/services/emotional-memory.test.ts \
        packages/server/src/services/emotional-memory.singleton.ts \
        packages/server/src/services/emotional-memory.singleton.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-emotional): detectMoodShift + computeShiftMagnitude helper + singleton accessor (C3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section D — IdentityService (1 task)

### Task D1: `IdentityService` skeleton + `getIdentity` + `updateIdentity` + style sync + singleton

**Files:**
- Create: `packages/server/src/services/bot-identity.ts`
- Create: `packages/server/src/services/bot-identity.test.ts`
- Create: `packages/server/src/services/bot-identity.singleton.ts`
- Create: `packages/server/src/services/bot-identity.singleton.test.ts`

**Logic:**
- `getIdentity`: `prisma.botIdentity.upsert` keyed by `userId`. Update branch is a no-op (existing row returned); create branch uses schema defaults (`botName: 'Эля'`, `avatar: '🤍'`, `style: 'friendly'`, `traits: {}`).
- `updateIdentity`: `prisma.botIdentity.update` (find-or-create first via `getIdentity` to handle missing row). If `updates.style` is provided and differs from current, also `prisma.user.update({ where: { id: userId }, data: { assistantStyle: updates.style } })` for back-compat with the existing 4-style routing in `claude-agent.ts`.
- Pure helper `pickIdentityUpdates(updates)` (very small) — whitelists keys (`botName`, `avatar`, `style`, `traits`) and drops everything else (defense against caller passing `id`/`userId`/`createdAt`).

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/bot-identity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickIdentityUpdates } from './bot-identity.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('pickIdentityUpdates — pure helper', () => {
  it('passes through whitelisted keys', () => {
    expect(
      pickIdentityUpdates({ botName: 'Ария', avatar: '🌸', style: 'calm', traits: {} }),
    ).toEqual({ botName: 'Ария', avatar: '🌸', style: 'calm', traits: {} });
  });

  it('drops unknown keys', () => {
    expect(
      pickIdentityUpdates({
        botName: 'X',
        id: 'cuid_evil',
        userId: 'other_user',
        createdAt: new Date(),
      } as Record<string, unknown>),
    ).toEqual({ botName: 'X' });
  });

  it('drops undefined values', () => {
    expect(pickIdentityUpdates({ botName: undefined, avatar: '🧊' })).toEqual({
      avatar: '🧊',
    });
  });

  it('returns empty object for empty input', () => {
    expect(pickIdentityUpdates({})).toEqual({});
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-identity.ts'),
  'utf-8',
);

describe('bot-identity.ts structural', () => {
  it('exports IdentityService class', () => {
    expect(SRC).toMatch(/export class IdentityService/);
  });

  it('declares IdentityServiceStore interface', () => {
    expect(SRC).toMatch(/export interface IdentityServiceStore/);
  });

  it('re-exports BotIdentity type', () => {
    expect(SRC).toMatch(/export type \{[^}]*BotIdentity[^}]*\}/);
  });

  it('exports pickIdentityUpdates helper', () => {
    expect(SRC).toMatch(/export function pickIdentityUpdates/);
  });

  it('getIdentity uses prisma.botIdentity.upsert', () => {
    const start = SRC.indexOf('async getIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botIdentity.upsert');
  });

  it('getIdentity create branch uses schema defaults', () => {
    const start = SRC.indexOf('async getIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    // empty create payload (schema provides defaults) OR explicit defaults
    expect(body).toMatch(/create: \{[\s\S]{0,400}\}/);
  });

  it('updateIdentity uses pickIdentityUpdates whitelist', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('pickIdentityUpdates(');
  });

  it('updateIdentity calls prisma.botIdentity.update', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.botIdentity.update');
  });

  it('updateIdentity syncs User.assistantStyle when style provided', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.user.update');
    expect(body).toContain('assistantStyle');
  });

  it('updateIdentity calls getIdentity first (ensures row exists)', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('this.getIdentity(');
  });
});
```

Create `packages/server/src/services/bot-identity.singleton.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-identity.singleton.ts'),
  'utf-8',
);

describe('bot-identity.singleton.ts structural', () => {
  it('exports getBotIdentityService accessor', () => {
    expect(SRC).toMatch(/export function getBotIdentityService/);
  });

  it('exports _resetBotIdentityServiceForTests test helper', () => {
    expect(SRC).toMatch(/export function _resetBotIdentityServiceForTests/);
  });

  it('singleton returns same instance on subsequent calls', async () => {
    const { getBotIdentityService, _resetBotIdentityServiceForTests } = await import(
      './bot-identity.singleton.js'
    );
    _resetBotIdentityServiceForTests();
    expect(getBotIdentityService()).toBe(getBotIdentityService());
  });

  it('_resetBotIdentityServiceForTests yields fresh instance', async () => {
    const { getBotIdentityService, _resetBotIdentityServiceForTests } = await import(
      './bot-identity.singleton.js'
    );
    _resetBotIdentityServiceForTests();
    const a = getBotIdentityService();
    _resetBotIdentityServiceForTests();
    const b = getBotIdentityService();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-identity.test.ts src/services/bot-identity.singleton.test.ts
```

Expected: FAIL — files missing.

- [ ] **Step 3: Create `bot-identity.ts`**

Create `packages/server/src/services/bot-identity.ts`:

```typescript
/**
 * v2.0 Tier 5 — Identity mini.
 *
 * BotIdentity per user (botName/avatar/style/traits). Phase A is a thin
 * upsert wrapper; Phase B will accumulate emergent personality traits.
 *
 * On style update, also syncs User.assistantStyle so the existing 4-style
 * routing in claude-agent.ts continues to work without modification.
 *
 * No wiring to onboarding/UI here — Week 5/6 plans wire this in.
 */

import { prisma } from '../lib/prisma.js';
import type { BotIdentity } from '@prisma/client';

export type { BotIdentity };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IdentityServiceStore {
  getIdentity(userId: string): Promise<BotIdentity>;
  updateIdentity(userId: string, updates: Partial<BotIdentity>): Promise<BotIdentity>;
}

// ---------------------------------------------------------------------------
// Pure helper (testable without DB)
// ---------------------------------------------------------------------------

type UpdatableKey = 'botName' | 'avatar' | 'style' | 'traits';
const UPDATABLE_KEYS: ReadonlyArray<UpdatableKey> = [
  'botName', 'avatar', 'style', 'traits',
];

/**
 * Whitelist update keys + drop undefined values. Prevents caller from
 * accidentally overwriting id/userId/createdAt.
 */
export function pickIdentityUpdates(
  updates: Record<string, unknown>,
): Partial<Pick<BotIdentity, UpdatableKey>> {
  const out: Partial<Pick<BotIdentity, UpdatableKey>> = {};
  for (const key of UPDATABLE_KEYS) {
    const v = updates[key];
    if (v !== undefined) {
      // Cast is safe — schema column types match Partial<BotIdentity> shape.
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// IdentityService implementation
// ---------------------------------------------------------------------------

export class IdentityService implements IdentityServiceStore {
  async getIdentity(userId: string): Promise<BotIdentity> {
    return prisma.botIdentity.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        // schema defaults: botName='Эля', avatar='🤍', style='friendly', traits={}
      },
    });
  }

  async updateIdentity(
    userId: string,
    updates: Partial<BotIdentity>,
  ): Promise<BotIdentity> {
    // Ensure row exists first.
    const existing = await this.getIdentity(userId);

    const safeUpdates = pickIdentityUpdates(updates as Record<string, unknown>);

    // Sync User.assistantStyle if style changed.
    if (
      typeof safeUpdates.style === 'string' &&
      safeUpdates.style !== existing.style
    ) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { assistantStyle: safeUpdates.style },
        });
      } catch (err) {
        console.warn(
          '[bot-identity] User.assistantStyle sync failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    return prisma.botIdentity.update({
      where: { userId },
      data: safeUpdates,
    });
  }
}
```

Create `packages/server/src/services/bot-identity.singleton.ts`:

```typescript
/**
 * v2.0 Tier 5 — singleton accessor for IdentityService.
 * Mirrors procedural-memory / emotional-memory singleton pattern.
 */

import { IdentityService } from './bot-identity.js';
import type { IdentityServiceStore } from './bot-identity.js';

let _instance: IdentityServiceStore | null = null;

export function getBotIdentityService(): IdentityServiceStore {
  if (!_instance) {
    _instance = new IdentityService();
  }
  return _instance;
}

export function _resetBotIdentityServiceForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-identity.test.ts src/services/bot-identity.singleton.test.ts
```

Expected: all PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Verify no vi.mock**

```bash
grep -c "vi\.mock" packages/server/src/services/bot-identity.test.ts \
       packages/server/src/services/bot-identity.singleton.test.ts
```

Expected: `0`.

- [ ] **Step 7: Confirm User.assistantStyle column exists in schema**

```bash
grep -n "assistantStyle" packages/server/prisma/schema.prisma
```

Expected: at least one match (model User). If not present, the plan needs revision — but this is a pre-existing column from earlier phases.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/bot-identity.ts \
        packages/server/src/services/bot-identity.test.ts \
        packages/server/src/services/bot-identity.singleton.ts \
        packages/server/src/services/bot-identity.singleton.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): IdentityService getIdentity/updateIdentity with User.assistantStyle sync + singleton (D1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section E — Verify (1 task)

### Task E1: Full verification — test suite + tsc + placeholder scan + progress note

**Files:**
- No new files — verification only.

- [ ] **Step 1: Run full server test suite**

```bash
cd packages/server
npm test
```

Expected output (all green): every previously-passing test PLUS new files:
- `procedural-memory.test.ts`
- `procedural-memory.singleton.test.ts`
- `emotional-memory.test.ts`
- `emotional-memory.singleton.test.ts`
- `bot-identity.test.ts`
- `bot-identity.singleton.test.ts`

- [ ] **Step 2: TypeScript strict check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: `Exit code 0` — no errors.

- [ ] **Step 3: Verify zero `vi.mock` across the entire `src/`**

```bash
grep -r "vi\.mock" packages/server/src/ | wc -l
```

Expected: `0`.

- [ ] **Step 4: Verify no "not yet implemented" stubs remain**

```bash
grep -rn "not yet implemented" packages/server/src/services/procedural-memory.ts \
                                packages/server/src/services/emotional-memory.ts \
                                packages/server/src/services/bot-identity.ts
```

Expected: empty (all task-stage placeholders have been replaced).

- [ ] **Step 5: Verify no "TODO"/"FIXME"/"Placeholder" in Week 4 files**

```bash
grep -rn "TODO\|FIXME\|^.*Placeholder" packages/server/src/services/procedural-memory.ts \
                                       packages/server/src/services/emotional-memory.ts \
                                       packages/server/src/services/bot-identity.ts \
                                       packages/server/src/services/procedural-memory.singleton.ts \
                                       packages/server/src/services/emotional-memory.singleton.ts \
                                       packages/server/src/services/bot-identity.singleton.ts
```

Expected: empty.

- [ ] **Step 6: Verify file structure exists**

```bash
ls packages/server/src/services/procedural-memory*.ts \
   packages/server/src/services/emotional-memory*.ts \
   packages/server/src/services/bot-identity*.ts
```

Expected:
```
procedural-memory.singleton.test.ts
procedural-memory.singleton.ts
procedural-memory.test.ts
procedural-memory.ts
emotional-memory.singleton.test.ts
emotional-memory.singleton.ts
emotional-memory.test.ts
emotional-memory.ts
bot-identity.singleton.test.ts
bot-identity.singleton.ts
bot-identity.test.ts
bot-identity.ts
```

- [ ] **Step 7: Verify existing `emotional-classifier.ts` is bit-identical to pre-Week-4 state**

```bash
git diff main -- packages/server/src/services/emotional-classifier.ts
```

Expected: empty (Week 4 must not touch the binary classifier).

- [ ] **Step 8: Verify zero schema modifications**

```bash
git diff main -- packages/server/prisma/schema.prisma
```

Expected: empty (all tables already created in Week 2 migration).

- [ ] **Step 9: Final progress commit**

```bash
git add docs/superpowers/plans/2026-05-30-v2-week4-tier4-tier5-identity.md
git commit --allow-empty -m "$(cat <<'EOF'
docs(v2-progress): Week 4 DONE — Tier 4 ProceduralMemory + Tier 5 EmotionalMemory + IdentityService

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec Coverage

| Interface method (spec §6.3 / §7.3) | Task |
|---|---|
| `ProceduralMemory.extractPatterns` | B8 — orchestrator over 5 extractors with Promise.allSettled + dedupe |
| `ProceduralMemory.getActivePatterns` | B2 — invalidAt-null + kinds/minConfidence filters |
| `ProceduralMemory.hasPattern` | B2 — findFirst + JSON.stringify payload compare |
| `ProceduralMemory.invalidateStale` | B2 — updateMany with cutoff, staleDays default 30 |
| Frequency extractor (spec §6.4) | B3 — median interval stability, importance≥5, 60-day window |
| Time-of-day extractor (spec §6.4) | B4 — hour histogram ±2h, 70%+ threshold |
| Recurring-topic extractor (spec §6.4) | B5 — greedy cosine clustering 0.75, importance≥7, >1/week baseline |
| Commitment extractor (spec §6.4) | B6 — regex prefilter + Claude haiku, 7-day window, JSON parse |
| Streak-break extractor (spec §6.4) | B7 — ≥42 logs, weekIndex bucketing, ≥2 same-week-of-streak breaks |
| `EmotionalMemory.analyzeMessage` | C1 — Claude haiku JSON, MoodSnapshot row, best-effort fallback |
| `EmotionalMemory.getMoodTimeline` | C2 — groupByDay over MoodSnapshot rows |
| `EmotionalMemory.getEntityMood` | C2 — avg(valence) over entityRefs |
| `EmotionalMemory.detectMoodShift` | C3 — last 3d vs prior 14d, magnitude ≥1.0, sinceDays=3 |
| `IdentityService.getIdentity` | D1 — Prisma upsert keyed by userId, schema defaults |
| `IdentityService.updateIdentity` | D1 — whitelisted updates + style sync to User.assistantStyle |
| Singleton (3x) | B8 (procedural), C3 (emotional), D1 (identity) |

All interface methods and all 5 extractors are mapped to a task.

### 2. Placeholder Scan

Intentional `throw new Error('X not yet implemented — Task BN')` stubs exist by design:
- B1 introduces 4 placeholders on `ProceduralMemory` class methods (extractPatterns, getActivePatterns, hasPattern, invalidateStale). Replaced fully by B2 (3 methods) and B8 (extractPatterns).
- C1 introduces 3 placeholders on `EmotionalMemory` (getMoodTimeline, getEntityMood, detectMoodShift). Replaced by C2 (2 methods) and C3 (detectMoodShift).
- D1 has no placeholders — both methods implemented in the same task.

By E1 Step 4 (`grep "not yet implemented"`) the count must be zero.

### 3. Type Consistency

| Symbol | Defined in | Used in |
|---|---|---|
| `ProceduralMemoryStore` interface | procedural-memory.ts (B1) | class implements (B1), singleton.ts (B8) |
| `EmotionalMemoryStore` interface | emotional-memory.ts (C1) | class implements (C1), singleton.ts (C3) |
| `IdentityServiceStore` interface | bot-identity.ts (D1) | class implements (D1), singleton.ts (D1) |
| `Pattern`, `MoodSnapshot`, `BotIdentity` Prisma types | re-exported by each module top | used by each module's methods + tests |
| Pure helpers — `medianInterval`/`stddev`/`clampConfidence`/`isStableInterval` | procedural-memory.ts (B1) | used by B3 (frequency) |
| `hourHistogramWindow` | procedural-memory.ts (B4) | used by B4 extractor |
| `cosineSimilarity`/`greedyCluster` | procedural-memory.ts (B5) | used by B5 extractor |
| `matchesCommitmentPhrase`/`parseCommitmentResponse` | procedural-memory.ts (B6) | used by B6 extractor |
| `weekIndex` | procedural-memory.ts (B7) | used by B7 extractor |
| `clampValence`/`clampArousal`/`normalizeEmotionLabel`/`parseMoodResponse` | emotional-memory.ts (C1) | used by `analyzeMessage` C1 |
| `groupByDay`/`dominantEmotion` | emotional-memory.ts (C2) | used by `getMoodTimeline` C2 |
| `computeShiftMagnitude` | emotional-memory.ts (C3) | used by `detectMoodShift` C3 |
| `pickIdentityUpdates` | bot-identity.ts (D1) | used by `updateIdentity` D1 |
| Singleton accessors `getXxx` + `_resetXxxForTests` | each `*.singleton.ts` | mirrored from working-memory.ts / entity-graph/index.ts |

No mismatches.

### 4. Test Pattern Compliance

- Zero `vi.mock` — confirmed by E1 Step 3 grep across all of `packages/server/src/`.
- Pure helpers exported separately from async methods — mirrors `episodic-memory.ts` (`clampMood`/`validateEventInput`) and `memory-service.ts` (`shouldOverwriteContent`/`computeExpiresAt`).
- Structural tests use `readFileSync` + content grep — mirrors `memory-service.test.ts`, `entity-graph/postgres-impl.test.ts`, `entity-extractor.test.ts`.
- Singleton reset helpers (`_resetXxxForTests`) mirror `_resetWorkingMemoryForTests` and `_resetEntityGraphForTests`.
- Singleton structural tests dynamic-import the singleton module from within the `it` block (matches the Week 3 D1 pattern that avoids stale module cache affecting `readFileSync` SRC at top-of-file).

### 5. Edge Case Enumeration

| Case | Handled by |
|---|---|
| New user with no entities / habits / events | Every extractor returns early `if (... .length === 0) return patterns` (or `continue` in per-entity loop) — graceful empty result, no throw |
| Entity has < 3 events in 60d | B3 frequency `if (events.length < 3) continue` |
| Habit has < 14 logs | B4 `if (hours.length < 14) continue` |
| Habit has < 42 logs (streak-break) | B7 `if (logs.length < 42) continue` |
| Entity has < 3 embedded memories | B5 `if (parsedVectors.length < 3) continue` |
| `Memory.embedding` is NULL (no Voyage at write-time) | B5 SQL `WHERE embedding IS NOT NULL`; non-numeric parse → skip |
| Claude haiku returns invalid JSON / 5xx | B6 commitment extractor: try/catch + `parseCommitmentResponse` returns null → skip; C1 analyzeMessage: try/catch + safe default neutral fallback |
| Mood shift with empty baseline | C3 `computeShiftMagnitude` falls back to raw diff; `detectMoodShift` requires `baseline.length >= 5` else returns `null` |
| Mood shift with all-equal baseline (sd=0) | C3 `computeShiftMagnitude` falls back to raw absolute diff |
| Pattern conflict (same kind, same payload from different extractors) | B8 dedupe by `(kind, JSON.stringify(payload))` — last wins |
| Pattern stale (no observations >30d) | B2 `invalidateStale` sweeps with default 30-day cutoff |
| `hasPattern` called with payload not yet in DB | B2 returns `null` (never throws) |
| `pickIdentityUpdates` called with attacker-controlled `id`/`userId`/`createdAt` | D1 whitelists only `botName`/`avatar`/`style`/`traits`; everything else dropped silently |
| Style change but BotIdentity row doesn't exist yet | D1 `updateIdentity` calls `this.getIdentity` first (upsert) to ensure row |
| Style sync to `User.assistantStyle` fails (User row deleted, race) | D1 wraps in try/catch + console.warn; BotIdentity update still proceeds |
| `MoodSnapshot.entityRefs` empty (analyzeMessage never sets it in Week 4) | C2 `getEntityMood` simply finds no rows → returns 0. Week 5 will populate entityRefs via EntityExtractor wiring |
| Concurrent calls to `extractPatterns` for same user | Each extractor independently re-finds active Pattern row → updates the same row deterministically; race could create duplicate rows briefly but `invalidateStale` cleans up; no constraint violation since `Pattern` has no unique index on `(userId, kind, payload)`. Acceptable for mini-version. |
| `clampValence(NaN)`, `clampArousal(NaN)` | C1 helpers return `0` / `0.5` safe defaults |
| `extractTimeOfDayPatterns` with HabitLog.date all-midnight | B4 falls back to scanning Memory `type='habit_completed'` with real `validAt`; if neither has variance → `pct < 0.7` → skip habit |

---

## Execution Handoff

**Plan complete.** Save this content verbatim to `docs/superpowers/plans/2026-05-30-v2-week4-tier4-tier5-identity.md`.

**Summary:** 13 tasks, ~99 numbered TDD steps, ~80 new tests (pure helpers + structural). Implements all 4 `ProceduralMemory` methods + 5 standalone extractor functions, all 4 `EmotionalMemory` methods, both `IdentityService` methods, and three singleton accessors. No schema changes. No wiring to `jarvis-orchestrator` — Week 5.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Use skill: `superpowers:subagent-driven-development`.

**2. Inline Execution** — tasks run in this session via `superpowers:executing-plans`, with checkpoints.

**Which approach?**
```

---

## Reporting back

- **Plan path (intended):** `/Users/berikkurmangoliev/Desktop/LifeOS/docs/superpowers/plans/2026-05-30-v2-week4-tier4-tier5-identity.md` (I am in read-only mode — the plan content is in this message above; please save it yourself or re-invoke me without the read-only constraint).
- **Approximate line count of plan content:** ~2,160 lines (within the 2,000-2,400 target).
- **Task count:** 13 atomic tasks (B1–B8, C1–C3, D1, E1).
- **Total TDD step count:** ~99 numbered steps (7 per task average, with B1/C1/C3/D1/E1 having 7–8 steps each).
- **Files this plan creates:** 12 new files (6 source + 6 test, split across 3 service modules + 3 singleton modules). Zero existing files modified. Zero schema changes.
- **Key compliance properties:** zero `vi.mock`, all pure helpers exported for unit testing, all Claude calls best-effort with safe defaults, all extractors handle empty data without throwing, one atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer, conventional commits `feat(v2-procedural):` / `feat(v2-emotional):` / `feat(v2-identity):` per the locked decisions.
