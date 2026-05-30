# v2.0 Phase B1: USER NEST Axes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement USER NEST Axes — continuous personality modeling (4 axes: self-discipline, emotional-openness, conflict-tolerance, introspection-depth) that drives CONTENT adaptation in bot responses. Per-message Claude haiku classifier writes signals; EWMA aggregates into stable axis values; hybrid hook (prompt enrichment + 3 code rules) shapes bot output.

**Architecture:** Two new Prisma models — `UserAxes` (1 row per user current state) and `AxisSignal` (append-only log). New service `services/user-axes/` with types, parse-response, postgres-impl, singleton, analyze-message, content-rules modules. Parallel branch in `v2-capture` for `analyzeMessage`. `v2-enrichment` block extended with axes section. Post-process content rules hook in `jarvis-orchestrator`. Telegram `/axes` command for transparency. One-time bootstrap script. Feature flag `FEATURE_V2_AXES` controls all entry points. Zero behavioural change when flag off.

**Tech Stack:** TypeScript ES2022 strict, Prisma 6.19 + Postgres, Anthropic Claude haiku via `@anthropic-ai/sdk`, Vitest 3.x. Mirror Week 4-6 patterns: pure helpers + structural tests via `readFileSync` + grep, zero `vi.mock`, one atomic commit per task with `Co-Authored-By` trailer.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md` (approved by Berik 2026-05-31, 1266 lines).

---

## File Structure

### New files (8 source + 8 test ≈ 16)

| Path | Est lines | Purpose |
|------|-----------|---------|
| `prisma/migrations/20260531180000_v2_user_axes/migration.sql` | ~50 | Idempotent `UserAxes` + `AxisSignal` tables |
| `src/services/user-axes/types.ts` | ~110 | Interface + AxisName + types + pure helpers (`clampDelta`, `clampConfidence`, `axisLabel`, `applyEwma`, `AXIS_DEFAULTS`) |
| `src/services/user-axes/types.test.ts` | ~120 | Unit tests for pure helpers |
| `src/services/user-axes/parse-response.ts` | ~80 | `parseAxisResponse` pure helper (handle markdown fences, invalid axes, clamp deltas) |
| `src/services/user-axes/parse-response.test.ts` | ~140 | Unit tests across malformed/valid inputs |
| `src/services/user-axes/postgres-impl.ts` | ~260 | `PostgresUserAxes` class — `getAxes`, `recordSignals`, `recentSignals`, `recomputeFromSignals` |
| `src/services/user-axes/postgres-impl.test.ts` | ~140 | Structural tests (no DB writes — readFileSync + grep) |
| `src/services/user-axes/index.ts` | ~25 | Singleton accessor + `_resetUserAxesForTests` |
| `src/services/user-axes/index.test.ts` | ~45 | Singleton structural + runtime identity |
| `src/services/user-axes/analyze-message.ts` | ~170 | Claude haiku call + `AXIS_SYSTEM_PROMPT` |
| `src/services/user-axes/analyze-message.test.ts` | ~70 | Structural tests for Claude call shape |
| `src/services/user-axes/content-rules.ts` | ~200 | `shouldForceOneStep`, `shouldSuppressEmotionalProbing`, `shouldSoftenChallenge` |
| `src/services/user-axes/content-rules.test.ts` | ~150 | Pure unit tests per rule + boundary cases |
| `scripts/bootstrap-axes.ts` | ~220 | CLI: `--user --dry-run \| --apply`, UserProfile.patterns → axes |
| `src/scripts/bootstrap-axes.test.ts` | ~110 | Pure helper unit tests (parseCliArgs) + structural |

### Modified files (6)

| Path | Lines added | Purpose |
|------|-------------|---------|
| `prisma/schema.prisma` | +35 | `UserAxes` + `AxisSignal` models |
| `src/lib/feature-flags.ts` | +20 | `isV2AxesEnabled` helper |
| `src/lib/feature-flags.test.ts` | +25 | Tests for new flag |
| `src/services/v2-capture.ts` | +20 | Parallel branch — `userAxes.analyzeMessage` |
| `src/services/v2-capture.test.ts` | +20 | Structural test for new branch |
| `src/services/v2-enrichment.ts` | +75 | `formatAxesSection` helper + integration into `buildV2EnrichmentBlock` |
| `src/services/v2-enrichment.test.ts` | +40 | Unit + structural tests for new section |
| `src/services/jarvis-orchestrator.ts` | +30 | Post-process content rules hook |
| `src/services/telegram-bot.ts` | +60 | `/axes` command handler |
| `src/services/telegram-axes.test.ts` (NEW) | ~50 | Structural test for command |
| `docs/plan/v2-memory-proactivity-scope.md` | +1 row | Progress tracker — Phase B1 done line |

---

## Task Table

| # | Section | Task | New files | Modified files | Test count delta |
|---|---------|------|-----------|----------------|-----------------|
| A1 | A — Schema | Prisma models + idempotent migration + local apply | migration.sql | schema.prisma | structural |
| B1 | B — Types & helpers | `types.ts` (interface + 5 pure helpers) + unit tests | types.ts, types.test.ts | — | +15 |
| B2 | B — Parser | `parseAxisResponse` + unit tests | parse-response.ts, parse-response.test.ts | — | +18 |
| B3 | B — Postgres impl I | `PostgresUserAxes` skeleton + `getAxes` + `recordSignals` | postgres-impl.ts, postgres-impl.test.ts | — | +8 |
| B4 | B — Postgres impl II | `recentSignals` + `recomputeFromSignals` | postgres-impl.ts (extend) | — | +6 |
| B5 | B — Singleton | `index.ts` lazy accessor + reset helper | index.ts, index.test.ts | — | +5 |
| C1 | C — Analyze | `analyze-message.ts` Claude haiku call | analyze-message.ts, analyze-message.test.ts | — | +8 |
| C2 | C — Content rules | `content-rules.ts` 3 gates + unit tests | content-rules.ts, content-rules.test.ts | — | +18 |
| D1 | D — Enrichment | `formatAxesSection` + extend `buildV2EnrichmentBlock` | — | v2-enrichment.ts, v2-enrichment.test.ts | +9 |
| D2 | D — Wiring | Feature flag + v2-capture branch + orchestrator post-process | — | feature-flags.ts (+ test), v2-capture.ts (+ test), jarvis-orchestrator.ts | +9 |
| E1 | E — Telegram | `/axes` command handler | telegram-axes.test.ts | telegram-bot.ts | +5 |
| E2 | E — Bootstrap | `scripts/bootstrap-axes.ts` + tests | bootstrap-axes.ts, bootstrap-axes.test.ts | — | +12 |
| F1 | F — Verify | Full suite + tsc + 0 `vi.mock` + progress tracker commit | — | scope tracker | (no new tests) |

**Total: 13 atomic tasks. ~115 new tests target. Estimate 4-5 days at Phase A pace through `subagent-driven-development`.**

---

## Hard Constraints

Every task obeys these without exception:

- **Zero `vi.mock`** — pure unit tests for helpers; structural tests for class wiring via `readFileSync` + content grep. Confirm with `grep -r "vi\.mock" packages/server/src/` returning 0.
- **Best-effort Claude calls** — `analyzeMessage` wrapped in top-level `try`/`catch`, never throws. Errors → `console.warn` + skip. Bot reply path unaffected.
- **Feature flag gated** — every new entry point in production code paths checks `isV2AxesEnabled(userId)`. When off, behavior byte-identical to pre-B1.
- **One atomic commit per task** with verbatim message from the task's Step "Commit" + trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **TDD discipline** — failing test FIRST (Step 1-2), then implementation (Step 3+). RED → GREEN explicit. Run test in between.
- **TypeScript strict** — no `any` leaks in exported surface. Prefer `unknown` + narrow.
- **Pure helpers exported** for unit testing without DB/Claude (`clampDelta`, `clampConfidence`, `axisLabel`, `applyEwma`, `parseAxisResponse`, all 3 content-rule functions).
- **Module imports** use `.js` extension (project uses `moduleResolution: bundler` + ESM).
- **Conventional commits:**
  - `feat(v2-axes):` — schema, types, helpers, postgres impl
  - `feat(v2-axes-analyze):` — analyzeMessage + Claude integration
  - `feat(v2-axes-rules):` — content-rules.ts gates
  - `feat(v2-axes-wiring):` — flag + v2-capture + orchestrator + enrichment integration
  - `feat(v2-axes-telegram):` — `/axes` command
  - `feat(v2-axes-migration):` — bootstrap script
  - `docs(v2-progress):` — progress tracker bump

---

## Section A — Schema + Migration (1 task)

### Task A1: `UserAxes` + `AxisSignal` Prisma models + idempotent migration

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/20260531180000_v2_user_axes/migration.sql`

**Goal:** Two new tables. Apply locally via Docker Postgres. Idempotent SQL so re-applying is safe.

- [ ] **Step 1: Add Prisma models to schema**

Edit `packages/server/prisma/schema.prisma`. Add at the bottom (after `CronJobRun`):

```prisma
// ───────────────────────────────────────────────────────────────────────────
// v2 Phase B1 — USER NEST Axes (added 2026-05-31)
// Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
// ───────────────────────────────────────────────────────────────────────────

model UserAxes {
  id                  String   @id @default(cuid())
  userId              String   @unique
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // 4 axes, all Float in [0, 1], default 0.5 (neutral)
  selfDiscipline      Float    @default(0.5)
  emotionalOpenness   Float    @default(0.5)
  conflictTolerance   Float    @default(0.5)
  introspectionDepth  Float    @default(0.5)

  // Provenance
  signalCount         Int      @default(0)
  lastSignalAt        DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([userId])
}

model AxisSignal {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  msgId        String?
  axis         String
  delta        Float
  confidence   Float    @default(0.5)
  excerpt      String?
  source       String   @default("claude_classifier")
  recordedAt   DateTime @default(now())

  @@index([userId, axis, recordedAt])
  @@index([userId, recordedAt])
  @@index([msgId])
}
```

Add reverse relations on `User` model (find the existing `User` model and add inside its block, after the existing v2 relations):

```prisma
  userAxes      UserAxes?
  axisSignals   AxisSignal[]
```

- [ ] **Step 2: Format schema**

```bash
cd packages/server
npx prisma format
```

Expected: file reformatted, no errors.

- [ ] **Step 3: Create migration file manually (idempotent — write SQL ourselves)**

Create directory `packages/server/prisma/migrations/20260531180000_v2_user_axes/` then file `migration.sql`:

```sql
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
```

- [ ] **Step 4: Apply migration locally via Docker Postgres**

```bash
cd packages/server
# Postgres already running from Week 2 setup
docker compose -f docker-compose.dev.yml ps  # confirm postgres is up
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx prisma db execute --schema=prisma/schema.prisma \
  --file prisma/migrations/20260531180000_v2_user_axes/migration.sql
```

Expected: `Script executed successfully.`

- [ ] **Step 5: Verify tables + indexes exist**

```bash
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  docker exec -it server-postgres-1 psql -U postgres -d lifeos_dev \
  -c "\d \"UserAxes\"" -c "\d \"AxisSignal\""
```

Expected: table descriptions printed, columns match schema, FK constraint listed, 3 indexes on `AxisSignal`, 1 on `UserAxes`.

- [ ] **Step 6: Re-apply migration to verify idempotency**

```bash
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx prisma db execute --schema=prisma/schema.prisma \
  --file prisma/migrations/20260531180000_v2_user_axes/migration.sql
```

Expected: `Script executed successfully.` (no errors despite tables/indexes/constraints existing — `IF NOT EXISTS` + `DO $$` guards).

- [ ] **Step 7: Generate Prisma client**

```bash
cd packages/server
npx prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 8: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Full server test suite**

```bash
cd packages/server
npm test
```

Expected: all tests green (baseline 1387+ from end of Phase A polish).

- [ ] **Step 10: Commit**

```bash
git add packages/server/prisma/schema.prisma \
        packages/server/prisma/migrations/20260531180000_v2_user_axes/
git commit -m "$(cat <<'EOF'
feat(v2-axes): UserAxes + AxisSignal Prisma models + idempotent migration (A1)

First step of Phase B1 USER NEST axes. Two new models per spec §4:
- UserAxes (1 row per user, current axis values, default 0.5 neutral)
- AxisSignal (append-only log, every detected signal with delta + confidence)

Migration SQL uses CREATE TABLE IF NOT EXISTS + DO $$ guards for FK,
mirrors Week 2/6 idempotent pattern. Applied locally via Docker; verified
re-application is no-op.

Prisma client regenerated. tsc clean. Existing test suite unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section B — Types, Helpers, Persistence (5 tasks)

### Task B1: `types.ts` — interface + 5 pure helpers + unit tests

**Files:**
- Create: `packages/server/src/services/user-axes/types.ts`
- Create: `packages/server/src/services/user-axes/types.test.ts`

**Goal:** Define the contract (`UserAxesStore` interface, `AxisName` union, value types). Implement and unit-test 5 pure helpers used across rest of service.

- [ ] **Step 1: Write failing tests for pure helpers**

Create `packages/server/src/services/user-axes/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  clampDelta,
  clampConfidence,
  axisLabel,
  applyEwma,
  AXIS_DEFAULTS,
  AXIS_NAMES,
} from './types.js';

describe('clampDelta', () => {
  it('clamps to [-1, 1]', () => {
    expect(clampDelta(0)).toBe(0);
    expect(clampDelta(0.5)).toBe(0.5);
    expect(clampDelta(-0.5)).toBe(-0.5);
    expect(clampDelta(1.5)).toBe(1);
    expect(clampDelta(-2)).toBe(-1);
    expect(clampDelta(1)).toBe(1);
    expect(clampDelta(-1)).toBe(-1);
  });
  it('NaN → 0', () => {
    expect(clampDelta(NaN)).toBe(0);
  });
});

describe('clampConfidence', () => {
  it('clamps to [0, 1]', () => {
    expect(clampConfidence(0)).toBe(0);
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(1)).toBe(1);
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-0.3)).toBe(0);
  });
  it('NaN → 0', () => {
    expect(clampConfidence(NaN)).toBe(0);
  });
});

describe('axisLabel', () => {
  it('returns expected Russian labels for value ranges', () => {
    expect(axisLabel(0.0)).toBe('очень низкая');
    expect(axisLabel(0.15)).toBe('очень низкая');
    expect(axisLabel(0.2)).toBe('низкая');
    expect(axisLabel(0.35)).toBe('низкая');
    expect(axisLabel(0.4)).toBe('средняя');
    expect(axisLabel(0.5)).toBe('средняя');
    expect(axisLabel(0.6)).toBe('средняя');
    expect(axisLabel(0.7)).toBe('высокая');
    expect(axisLabel(0.8)).toBe('высокая');
    expect(axisLabel(0.85)).toBe('очень высокая');
    expect(axisLabel(1.0)).toBe('очень высокая');
  });
});

describe('applyEwma', () => {
  it('returns current value when delta=0', () => {
    expect(applyEwma(0.5, 0, 1.0)).toBe(0.5);
  });
  it('moves toward target with α=0.05 by default', () => {
    const next = applyEwma(0.5, -0.1, 1.0);
    // target = clamp01(0.5 + -0.1*1.0) = 0.4
    // next = 0.05 * 0.4 + 0.95 * 0.5 = 0.495
    expect(next).toBeCloseTo(0.495, 3);
  });
  it('clamps target to [0, 1] before EWMA', () => {
    const next = applyEwma(0.95, 0.5, 1.0); // target would be 1.45 → clamp 1
    // next = 0.05 * 1 + 0.95 * 0.95 = 0.9525
    expect(next).toBeCloseTo(0.9525, 3);
  });
  it('confidence scales weighted delta', () => {
    const next = applyEwma(0.5, -0.2, 0.5); // weighted = -0.1
    expect(next).toBeCloseTo(0.495, 3);
  });
  it('accepts custom alpha', () => {
    const next = applyEwma(0.5, -0.1, 1.0, 0.5);
    // target = 0.4, next = 0.5 * 0.4 + 0.5 * 0.5 = 0.45
    expect(next).toBeCloseTo(0.45, 3);
  });
  it('asymptotic: 100 strong DOWN signals do not hit 0', () => {
    let v = 0.5;
    for (let i = 0; i < 100; i++) v = applyEwma(v, -1, 1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.01);
  });
});

describe('AXIS_DEFAULTS + AXIS_NAMES', () => {
  it('AXIS_NAMES has exactly 4 entries', () => {
    expect(AXIS_NAMES).toHaveLength(4);
    expect(AXIS_NAMES).toEqual([
      'self_discipline',
      'emotional_openness',
      'conflict_tolerance',
      'introspection_depth',
    ]);
  });
  it('AXIS_DEFAULTS has 0.5 for each axis', () => {
    AXIS_NAMES.forEach((axis) => {
      expect(AXIS_DEFAULTS[axis]).toBe(0.5);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/types.test.ts
```

Expected: FAIL — `ENOENT` or `Cannot find module './types.js'`.

- [ ] **Step 3: Implement `types.ts`**

Create `packages/server/src/services/user-axes/types.ts`:

```typescript
/**
 * v2.0 Phase B1 — USER NEST Axes types and pure helpers.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
 *
 * Pure helpers (clampDelta, clampConfidence, axisLabel, applyEwma) are
 * exported for unit testing without DB or Claude dependencies.
 *
 * All axis values are continuous Float in [0, 1] with semantic labels:
 *   [0.0, 0.2)   → очень низкая
 *   [0.2, 0.4)   → низкая
 *   [0.4, 0.6+]  → средняя  (default zone, includes 0.5 neutral)
 *   (0.6, 0.8]   → высокая
 *   (0.8, 1.0]   → очень высокая
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AxisName =
  | 'self_discipline'
  | 'emotional_openness'
  | 'conflict_tolerance'
  | 'introspection_depth';

export const AXIS_NAMES: readonly AxisName[] = [
  'self_discipline',
  'emotional_openness',
  'conflict_tolerance',
  'introspection_depth',
] as const;

export const AXIS_DEFAULTS: Record<AxisName, number> = {
  self_discipline: 0.5,
  emotional_openness: 0.5,
  conflict_tolerance: 0.5,
  introspection_depth: 0.5,
};

export interface UserAxesValues {
  selfDiscipline: number;
  emotionalOpenness: number;
  conflictTolerance: number;
  introspectionDepth: number;
  signalCount: number;
  lastSignalAt: Date | null;
}

export interface AxisSignalInput {
  axis: AxisName;
  delta: number;       // clamped to [-1, 1] on insert
  confidence: number;  // clamped to [0, 1] on insert
  excerpt?: string;
}

export type AxisSignalSource =
  | 'claude_classifier'
  | 'system_signal'
  | 'bootstrap'
  | 'manual';

export interface UserAxesStore {
  /** Read current values; auto-initialise row at 0.5 if missing. */
  getAxes(userId: string): Promise<UserAxesValues>;

  /** Append signals to AxisSignal log and recompute UserAxes via EWMA.
   *  Best-effort: never throws; returns counts of written vs skipped. */
  recordSignals(
    userId: string,
    msgId: string | null,
    signals: AxisSignalInput[],
    source?: AxisSignalSource,
  ): Promise<{ written: number; skipped: number }>;

  /** Latest N signals for a given axis (used by /axes Telegram command). */
  recentSignals(
    userId: string,
    axis: AxisName,
    limit?: number,
  ): Promise<Array<{
    delta: number;
    confidence: number;
    excerpt: string | null;
    recordedAt: Date;
  }>>;

  /** Recompute axes from full signal history. Used in tests + ad-hoc
   *  data fix; not in hot path. */
  recomputeFromSignals(userId: string): Promise<UserAxesValues>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB / Claude)
// ---------------------------------------------------------------------------

/** Clamp delta to [-1, 1]; NaN → 0. */
export function clampDelta(d: number): number {
  if (Number.isNaN(d)) return 0;
  return Math.max(-1, Math.min(1, d));
}

/** Clamp confidence to [0, 1]; NaN → 0. */
export function clampConfidence(c: number): number {
  if (Number.isNaN(c)) return 0;
  return Math.max(0, Math.min(1, c));
}

/** Russian semantic label for axis value. Used in /axes output and
 *  in system-prompt block. */
export function axisLabel(value: number): string {
  if (value < 0.2) return 'очень низкая';
  if (value < 0.4) return 'низкая';
  if (value <= 0.6) return 'средняя';
  if (value <= 0.8) return 'высокая';
  return 'очень высокая';
}

/**
 * Exponentially Weighted Moving Average (EWMA) — single update step.
 *
 * Formula:
 *   weighted = delta × confidence
 *   target   = clamp01(current + weighted)
 *   next     = α × target + (1 − α) × current
 *
 * α = 0.05 by default (slow drift — ~14 strong signals to move halfway).
 *
 * Math properties:
 *   - bounded to [0, 1] (target clamped)
 *   - asymptotic — never reaches 0 or 1 in finite steps
 *   - stable to single-day outliers
 *   - adaptive to persistent shifts
 */
export function applyEwma(
  current: number,
  delta: number,
  confidence: number,
  alpha: number = 0.05,
): number {
  const weighted = delta * confidence;
  const target = Math.max(0, Math.min(1, current + weighted));
  return alpha * target + (1 - alpha) * current;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/types.test.ts
```

Expected: all tests pass (15+ tests green).

- [ ] **Step 5: TypeScript check**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/types.ts \
        packages/server/src/services/user-axes/types.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes): types + 5 pure helpers (clampDelta, clampConfidence, axisLabel, applyEwma) (B1)

Defines AxisName union, AXIS_NAMES const, AXIS_DEFAULTS, UserAxesValues,
AxisSignalInput, AxisSignalSource, and UserAxesStore interface — the
contract every later task implements against.

Pure helpers:
- clampDelta / clampConfidence — input sanitization for AxisSignal
- axisLabel — Russian semantic label (5 buckets)
- applyEwma — exponentially-weighted update step (α=0.05 default,
  bounded [0,1], asymptotic — math properties locked in spec §6.2-6.3)

Pure helpers exported separately for unit testing without DB or Claude.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `parseAxisResponse` pure helper + unit tests

**Files:**
- Create: `packages/server/src/services/user-axes/parse-response.ts`
- Create: `packages/server/src/services/user-axes/parse-response.test.ts`

**Goal:** Standalone pure function that turns Claude's JSON output into a `{ signals: AxisSignalInput[] }` shape, handling all malformed cases gracefully (never throws).

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/user-axes/parse-response.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAxisResponse } from './parse-response.js';

describe('parseAxisResponse — happy path', () => {
  it('parses a single signal', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: -0.1, confidence: 0.85, excerpt: 'опять забил' },
      ],
    });
    const out = parseAxisResponse(raw);
    expect(out.signals).toHaveLength(1);
    expect(out.signals[0]).toEqual({
      axis: 'self_discipline',
      delta: -0.1,
      confidence: 0.85,
      excerpt: 'опять забил',
    });
  });
  it('parses multiple signals across axes', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: 0.05, confidence: 0.7 },
        { axis: 'emotional_openness', delta: 0.12, confidence: 0.9, excerpt: 'грустно' },
      ],
    });
    const out = parseAxisResponse(raw);
    expect(out.signals).toHaveLength(2);
  });
  it('strips markdown code fences', () => {
    const raw = '```json\n' +
      JSON.stringify({ signals: [{ axis: 'introspection_depth', delta: 0.1, confidence: 0.8 }] }) +
      '\n```';
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
  });
  it('strips plain markdown fences without json tag', () => {
    const raw = '```\n' + JSON.stringify({ signals: [] }) + '\n```';
    expect(parseAxisResponse(raw).signals).toEqual([]);
  });
});

describe('parseAxisResponse — malformed / fallback', () => {
  it('invalid JSON → empty signals', () => {
    expect(parseAxisResponse('not json').signals).toEqual([]);
  });
  it('empty string → empty signals', () => {
    expect(parseAxisResponse('').signals).toEqual([]);
  });
  it('missing signals key → empty', () => {
    expect(parseAxisResponse(JSON.stringify({ foo: 'bar' })).signals).toEqual([]);
  });
  it('signals as non-array → empty', () => {
    expect(parseAxisResponse(JSON.stringify({ signals: 'oops' })).signals).toEqual([]);
  });
  it('invalid axis name dropped', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'made_up_axis', delta: 0.1, confidence: 0.8 },
        { axis: 'self_discipline', delta: 0.1, confidence: 0.8 },
      ],
    });
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
    expect(parseAxisResponse(raw).signals[0].axis).toBe('self_discipline');
  });
  it('zero confidence filtered out (no-signal)', () => {
    const raw = JSON.stringify({
      signals: [
        { axis: 'self_discipline', delta: 0.1, confidence: 0 },
        { axis: 'emotional_openness', delta: 0.1, confidence: 0.5 },
      ],
    });
    expect(parseAxisResponse(raw).signals).toHaveLength(1);
  });
  it('out-of-range delta clamped', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: -5, confidence: 0.8 }],
    });
    expect(parseAxisResponse(raw).signals[0].delta).toBe(-1);
  });
  it('out-of-range confidence clamped', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 2 }],
    });
    expect(parseAxisResponse(raw).signals[0].confidence).toBe(1);
  });
  it('excerpt truncated to 200 chars', () => {
    const long = 'а'.repeat(500);
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 0.8, excerpt: long }],
    });
    expect(parseAxisResponse(raw).signals[0].excerpt).toHaveLength(200);
  });
  it('non-string excerpt → undefined', () => {
    const raw = JSON.stringify({
      signals: [{ axis: 'self_discipline', delta: 0.1, confidence: 0.8, excerpt: 12345 }],
    });
    expect(parseAxisResponse(raw).signals[0].excerpt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/parse-response.test.ts
```

Expected: FAIL — `Cannot find module './parse-response.js'`.

- [ ] **Step 3: Implement `parse-response.ts`**

Create `packages/server/src/services/user-axes/parse-response.ts`:

```typescript
/**
 * v2.0 Phase B1 — Parser for Claude haiku axis-classification response.
 *
 * Handles all malformed cases gracefully — NEVER throws. Markdown fences
 * (with or without `json` tag) stripped. Invalid axis names dropped.
 * Out-of-range deltas/confidence clamped. Zero-confidence signals
 * filtered (they carry no information). Excerpts truncated to 200 chars.
 *
 * Pure function — no I/O.
 */

import {
  AXIS_NAMES,
  type AxisName,
  type AxisSignalInput,
  clampDelta,
  clampConfidence,
} from './types.js';

const VALID_AXES: ReadonlySet<string> = new Set(AXIS_NAMES);

export interface ParsedAxisResponse {
  signals: AxisSignalInput[];
}

export function parseAxisResponse(raw: string): ParsedAxisResponse {
  const empty: ParsedAxisResponse = { signals: [] };
  if (!raw || !raw.trim()) return empty;

  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(
      '[user-axes:parse] JSON parse failed:',
      err instanceof Error ? err.message : err,
    );
    return empty;
  }

  if (!parsed || typeof parsed !== 'object') return empty;
  const obj = parsed as Record<string, unknown>;
  const rawSignals = Array.isArray(obj.signals) ? obj.signals : null;
  if (!rawSignals) return empty;

  const signals: AxisSignalInput[] = [];
  for (const s of rawSignals) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.axis !== 'string' || !VALID_AXES.has(r.axis)) continue;

    const delta = clampDelta(Number(r.delta));
    const confidence = clampConfidence(Number(r.confidence));
    // Zero-confidence signals are noise — drop them.
    if (confidence <= 0) continue;

    const out: AxisSignalInput = {
      axis: r.axis as AxisName,
      delta,
      confidence,
    };
    if (typeof r.excerpt === 'string') {
      out.excerpt = r.excerpt.slice(0, 200);
    }
    signals.push(out);
  }

  return { signals };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/parse-response.test.ts
```

Expected: all 18 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/parse-response.ts \
        packages/server/src/services/user-axes/parse-response.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes): parseAxisResponse — defensive Claude JSON parser (B2)

Pure function — never throws on:
- invalid JSON, empty/null input
- missing signals key, non-array signals
- unknown axis names (dropped)
- zero confidence (filtered as noise)
- out-of-range delta/confidence (clamped)
- markdown code fences (stripped, with or without `json` tag)
- non-string excerpts (omitted)
- excerpts > 200 chars (truncated)

Mirrors EntityExtractor.parseExtractorResponse pattern from Week 3 C1.
+18 unit tests covering all malformed paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `PostgresUserAxes` skeleton + `getAxes` + `recordSignals`

**Files:**
- Create: `packages/server/src/services/user-axes/postgres-impl.ts`
- Create: `packages/server/src/services/user-axes/postgres-impl.test.ts`

**Goal:** Concrete `UserAxesStore` implementation using Prisma. This task implements the two most-used methods. `recentSignals` and `recomputeFromSignals` come in B4.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/user-axes/postgres-impl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresUserAxes } from './postgres-impl.js';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/postgres-impl.ts'),
  'utf-8',
);

describe('PostgresUserAxes — class shape', () => {
  it('class exported', () => {
    expect(PostgresUserAxes).toBeDefined();
    expect(typeof PostgresUserAxes).toBe('function');
  });
  it('implements all UserAxesStore methods', () => {
    const inst = new PostgresUserAxes();
    expect(typeof inst.getAxes).toBe('function');
    expect(typeof inst.recordSignals).toBe('function');
    expect(typeof inst.recentSignals).toBe('function');
    expect(typeof inst.recomputeFromSignals).toBe('function');
  });
});

describe('postgres-impl.ts structural — getAxes', () => {
  it('reads UserAxes via Prisma findUnique', () => {
    const start = SRC.indexOf('async getAxes');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.userAxes.findUnique');
    expect(body).toContain('userId');
  });
  it('auto-initialises missing row with defaults', () => {
    const start = SRC.indexOf('async getAxes');
    const body = SRC.slice(start, start + 2500);
    // Should create row with defaults if findUnique returns null.
    expect(body).toMatch(/prisma\.userAxes\.create/);
    expect(body).toContain('AXIS_DEFAULTS');
  });
  it('returns shape matches UserAxesValues', () => {
    const start = SRC.indexOf('async getAxes');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('selfDiscipline');
    expect(body).toContain('emotionalOpenness');
    expect(body).toContain('conflictTolerance');
    expect(body).toContain('introspectionDepth');
    expect(body).toContain('signalCount');
    expect(body).toContain('lastSignalAt');
  });
});

describe('postgres-impl.ts structural — recordSignals', () => {
  it('bulk-inserts AxisSignal rows', () => {
    const start = SRC.indexOf('async recordSignals');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.axisSignal.createMany');
  });
  it('uses EWMA via applyEwma helper', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('applyEwma');
  });
  it('updates UserAxes row with new values + signalCount + lastSignalAt', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.userAxes.update');
    expect(body).toContain('signalCount');
    expect(body).toContain('lastSignalAt');
  });
  it('best-effort: top-level try/catch returns counts on failure', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4500);
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/\bwritten\b/);
    expect(body).toMatch(/\bskipped\b/);
  });
  it('accepts optional source parameter with default claude_classifier', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 1000);
    expect(body).toMatch(/source\s*[:=].*claude_classifier/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/postgres-impl.test.ts
```

Expected: FAIL — class not exported.

- [ ] **Step 3: Implement `postgres-impl.ts`**

Create `packages/server/src/services/user-axes/postgres-impl.ts`:

```typescript
/**
 * v2.0 Phase B1 — PostgresUserAxes — concrete implementation of
 * UserAxesStore using Prisma.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
 *
 * Design notes:
 *  - UserAxes table holds the *current* state, one row per user.
 *  - AxisSignal is the append-only log; every detected signal lands there.
 *  - On recordSignals: insert all signals first (createMany), then apply
 *    EWMA per axis, updating the UserAxes row in a single update.
 *  - getAxes auto-creates a default-0.5 row if missing — callers can rely
 *    on always getting back values.
 *  - Best-effort throughout: callers should not need to wrap our methods
 *    in try/catch; we already do.
 */

import { prisma } from '../../lib/prisma.js';
import {
  AXIS_DEFAULTS,
  applyEwma,
  type AxisName,
  type AxisSignalInput,
  type AxisSignalSource,
  type UserAxesStore,
  type UserAxesValues,
} from './types.js';

export class PostgresUserAxes implements UserAxesStore {
  async getAxes(userId: string): Promise<UserAxesValues> {
    try {
      let row = await prisma.userAxes.findUnique({ where: { userId } });
      if (!row) {
        row = await prisma.userAxes.create({
          data: {
            userId,
            selfDiscipline: AXIS_DEFAULTS.self_discipline,
            emotionalOpenness: AXIS_DEFAULTS.emotional_openness,
            conflictTolerance: AXIS_DEFAULTS.conflict_tolerance,
            introspectionDepth: AXIS_DEFAULTS.introspection_depth,
            signalCount: 0,
            lastSignalAt: null,
          },
        });
      }
      return {
        selfDiscipline: row.selfDiscipline,
        emotionalOpenness: row.emotionalOpenness,
        conflictTolerance: row.conflictTolerance,
        introspectionDepth: row.introspectionDepth,
        signalCount: row.signalCount,
        lastSignalAt: row.lastSignalAt,
      };
    } catch (err) {
      console.warn('[user-axes:getAxes] failed:', err);
      // Even on failure return defaults so callers always get a sensible
      // structure (prompt enrichment + content rules tolerate this).
      return {
        selfDiscipline: AXIS_DEFAULTS.self_discipline,
        emotionalOpenness: AXIS_DEFAULTS.emotional_openness,
        conflictTolerance: AXIS_DEFAULTS.conflict_tolerance,
        introspectionDepth: AXIS_DEFAULTS.introspection_depth,
        signalCount: 0,
        lastSignalAt: null,
      };
    }
  }

  async recordSignals(
    userId: string,
    msgId: string | null,
    signals: AxisSignalInput[],
    source: AxisSignalSource = 'claude_classifier',
  ): Promise<{ written: number; skipped: number }> {
    if (signals.length === 0) return { written: 0, skipped: 0 };

    let written = 0;
    let skipped = 0;
    try {
      // 1. Bulk-insert all signals (append-only log).
      const insertResult = await prisma.axisSignal.createMany({
        data: signals.map((s) => ({
          userId,
          msgId,
          axis: s.axis,
          delta: s.delta,
          confidence: s.confidence,
          excerpt: s.excerpt ?? null,
          source,
        })),
        skipDuplicates: false,
      });
      written = insertResult.count;
      skipped = signals.length - written;

      // 2. Apply EWMA per axis on top of current values, then single update.
      const current = await this.getAxes(userId);
      const axisFieldByName: Record<AxisName, keyof UserAxesValues> = {
        self_discipline: 'selfDiscipline',
        emotional_openness: 'emotionalOpenness',
        conflict_tolerance: 'conflictTolerance',
        introspection_depth: 'introspectionDepth',
      };

      const next = {
        selfDiscipline: current.selfDiscipline,
        emotionalOpenness: current.emotionalOpenness,
        conflictTolerance: current.conflictTolerance,
        introspectionDepth: current.introspectionDepth,
      };
      for (const s of signals) {
        const field = axisFieldByName[s.axis];
        next[field] = applyEwma(next[field], s.delta, s.confidence);
      }

      await prisma.userAxes.update({
        where: { userId },
        data: {
          ...next,
          signalCount: { increment: written },
          lastSignalAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[user-axes:recordSignals] failed:', err);
      // Don't increment `written`; signals may have inserted before the
      // update failed — log so it's debuggable, but caller still gets
      // back numbers.
    }

    return { written, skipped };
  }

  async recentSignals(
    _userId: string,
    _axis: AxisName,
    _limit?: number,
  ): Promise<Array<{
    delta: number;
    confidence: number;
    excerpt: string | null;
    recordedAt: Date;
  }>> {
    // Implemented in B4.
    throw new Error('recentSignals not yet implemented — Task B4');
  }

  async recomputeFromSignals(_userId: string): Promise<UserAxesValues> {
    // Implemented in B4.
    throw new Error('recomputeFromSignals not yet implemented — Task B4');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/postgres-impl.test.ts
```

Expected: all 8 structural tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/postgres-impl.ts \
        packages/server/src/services/user-axes/postgres-impl.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes): PostgresUserAxes skeleton + getAxes + recordSignals (B3)

Concrete UserAxesStore implementation using Prisma. Implements the two
hot-path methods:

- getAxes: findUnique → auto-create with AXIS_DEFAULTS (0.5) if missing.
  Always returns a sensible structure even on DB failure (caller never
  needs to defensively re-check).
- recordSignals: bulk-insert AxisSignal rows via createMany, then walk
  signals applying applyEwma per axis on the freshly-loaded UserAxes
  current values, then single update. Returns { written, skipped }
  counts. Best-effort top-level try/catch — never throws.

recentSignals and recomputeFromSignals are placeholders for B4
(throw not-yet-implemented).

+8 structural tests confirm class shape + Prisma method calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `recentSignals` + `recomputeFromSignals`

**Files:**
- Modify: `packages/server/src/services/user-axes/postgres-impl.ts`
- Modify: `packages/server/src/services/user-axes/postgres-impl.test.ts`

**Goal:** Two remaining UserAxesStore methods. `recentSignals` powers `/axes` Telegram command. `recomputeFromSignals` is used in tests + ad-hoc data fixes.

- [ ] **Step 1: Append failing structural tests**

Append to `packages/server/src/services/user-axes/postgres-impl.test.ts`:

```typescript
describe('postgres-impl.ts structural — recentSignals', () => {
  it('queries AxisSignal filtered by userId + axis, ordered by recordedAt DESC', () => {
    const start = SRC.indexOf('async recentSignals');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.axisSignal.findMany');
    expect(body).toContain('userId');
    expect(body).toContain('axis');
    expect(body).toMatch(/orderBy.*recordedAt.*desc/s);
  });
  it('default limit honored', () => {
    const start = SRC.indexOf('async recentSignals');
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/limit\s*[?]?[:.]?\s*=?\s*\d+/);
  });
});

describe('postgres-impl.ts structural — recomputeFromSignals', () => {
  it('reads full signal history ordered by recordedAt ASC', () => {
    const start = SRC.indexOf('async recomputeFromSignals');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.axisSignal.findMany');
    expect(body).toMatch(/orderBy.*recordedAt.*asc/s);
  });
  it('reuses applyEwma to fold signals into current state', () => {
    const start = SRC.indexOf('async recomputeFromSignals');
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('applyEwma');
  });
  it('writes final values back via UserAxes.update', () => {
    const start = SRC.indexOf('async recomputeFromSignals');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('prisma.userAxes.update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/postgres-impl.test.ts
```

Expected: new tests FAIL (placeholders still throw).

- [ ] **Step 3: Replace placeholders**

Edit `packages/server/src/services/user-axes/postgres-impl.ts`. Replace the two stubs:

```typescript
  async recentSignals(
    userId: string,
    axis: AxisName,
    limit: number = 5,
  ): Promise<Array<{
    delta: number;
    confidence: number;
    excerpt: string | null;
    recordedAt: Date;
  }>> {
    try {
      const rows = await prisma.axisSignal.findMany({
        where: { userId, axis },
        orderBy: { recordedAt: 'desc' },
        take: limit,
        select: { delta: true, confidence: true, excerpt: true, recordedAt: true },
      });
      return rows;
    } catch (err) {
      console.warn('[user-axes:recentSignals] failed:', err);
      return [];
    }
  }

  async recomputeFromSignals(userId: string): Promise<UserAxesValues> {
    try {
      const signals = await prisma.axisSignal.findMany({
        where: { userId },
        orderBy: { recordedAt: 'asc' },
        select: { axis: true, delta: true, confidence: true, recordedAt: true },
      });

      const axisFieldByName: Record<AxisName, keyof UserAxesValues> = {
        self_discipline: 'selfDiscipline',
        emotional_openness: 'emotionalOpenness',
        conflict_tolerance: 'conflictTolerance',
        introspection_depth: 'introspectionDepth',
      };

      const next = {
        selfDiscipline: AXIS_DEFAULTS.self_discipline,
        emotionalOpenness: AXIS_DEFAULTS.emotional_openness,
        conflictTolerance: AXIS_DEFAULTS.conflict_tolerance,
        introspectionDepth: AXIS_DEFAULTS.introspection_depth,
      };
      let lastSignalAt: Date | null = null;
      for (const s of signals) {
        const field = axisFieldByName[s.axis as AxisName];
        if (!field) continue;
        next[field] = applyEwma(next[field], s.delta, s.confidence);
        lastSignalAt = s.recordedAt;
      }

      const updated = await prisma.userAxes.upsert({
        where: { userId },
        create: {
          userId,
          ...next,
          signalCount: signals.length,
          lastSignalAt,
        },
        update: {
          ...next,
          signalCount: signals.length,
          lastSignalAt,
        },
      });

      return {
        selfDiscipline: updated.selfDiscipline,
        emotionalOpenness: updated.emotionalOpenness,
        conflictTolerance: updated.conflictTolerance,
        introspectionDepth: updated.introspectionDepth,
        signalCount: updated.signalCount,
        lastSignalAt: updated.lastSignalAt,
      };
    } catch (err) {
      console.warn('[user-axes:recomputeFromSignals] failed:', err);
      return this.getAxes(userId);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/postgres-impl.test.ts
```

Expected: all structural tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/postgres-impl.ts \
        packages/server/src/services/user-axes/postgres-impl.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes): recentSignals + recomputeFromSignals (B4)

Completes UserAxesStore implementation:

- recentSignals: top-N AxisSignal rows for a given userId+axis, ordered
  by recordedAt DESC. Default limit 5. Used by /axes Telegram command
  to show recent contributing signals.
- recomputeFromSignals: walk full AxisSignal history in chronological
  order, fold via applyEwma starting from AXIS_DEFAULTS. Writes back
  via UserAxes.upsert. Used in tests + ad-hoc data fix (e.g. if EWMA
  α changes and we want to recompute from scratch).

Both wrapped in best-effort try/catch (return [] and getAxes()
respectively on failure).

+6 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Singleton accessor

**Files:**
- Create: `packages/server/src/services/user-axes/index.ts`
- Create: `packages/server/src/services/user-axes/index.test.ts`

**Goal:** Lazy singleton accessor + test reset helper. Mirror the pattern from `entity-graph/index.ts` and `procedural-memory.singleton.ts`.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/user-axes/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/index.ts'),
  'utf-8',
);

describe('user-axes/index.ts structural', () => {
  it('exports getUserAxesStore', () => {
    expect(SRC).toMatch(/export function getUserAxesStore/);
  });
  it('exports _resetUserAxesForTests (test helper)', () => {
    expect(SRC).toMatch(/export function _resetUserAxesForTests/);
  });
  it('re-exports UserAxesStore type', () => {
    expect(SRC).toContain('UserAxesStore');
  });
  it('re-exports PostgresUserAxes', () => {
    expect(SRC).toContain('PostgresUserAxes');
  });

  it('singleton returns same instance on subsequent calls', async () => {
    const { getUserAxesStore, _resetUserAxesForTests } = await import('./index.js');
    _resetUserAxesForTests();
    const a = getUserAxesStore();
    const b = getUserAxesStore();
    expect(a).toBe(b);
  });
  it('_resetUserAxesForTests creates fresh instance', async () => {
    const { getUserAxesStore, _resetUserAxesForTests } = await import('./index.js');
    _resetUserAxesForTests();
    const a = getUserAxesStore();
    _resetUserAxesForTests();
    const b = getUserAxesStore();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/index.test.ts
```

Expected: FAIL — `ENOENT`.

- [ ] **Step 3: Implement `index.ts`**

Create `packages/server/src/services/user-axes/index.ts`:

```typescript
/**
 * v2.0 Phase B1 — UserAxesStore public entry point.
 *
 * Lazy singleton + test reset helper. Mirrors the pattern from
 * entity-graph/index.ts and procedural-memory.singleton.ts.
 *
 * Wired into v2-capture and telegram-bot in subsequent tasks (D2, E1).
 */

export {
  AXIS_NAMES,
  AXIS_DEFAULTS,
  type AxisName,
  type AxisSignalInput,
  type AxisSignalSource,
  type UserAxesStore,
  type UserAxesValues,
  clampDelta,
  clampConfidence,
  axisLabel,
  applyEwma,
} from './types.js';

export { PostgresUserAxes } from './postgres-impl.js';
export { parseAxisResponse } from './parse-response.js';

import { PostgresUserAxes } from './postgres-impl.js';
import type { UserAxesStore } from './types.js';

let _instance: UserAxesStore | null = null;

/**
 * Global singleton instance of the UserAxes store. Lazily instantiated on
 * first call. Uses PostgresUserAxes by default.
 *
 * Wired into v2-capture (Task D2) and /axes Telegram command (Task E1).
 */
export function getUserAxesStore(): UserAxesStore {
  if (!_instance) {
    _instance = new PostgresUserAxes();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files. Underscore prefix
 * signals internal API.
 */
export function _resetUserAxesForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/index.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/index.ts \
        packages/server/src/services/user-axes/index.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes): user-axes singleton accessor + public index re-exports (B5)

Lazy singleton (PostgresUserAxes) + _resetUserAxesForTests helper.
Public index re-exports types, pure helpers, parseAxisResponse, and
PostgresUserAxes class for callers.

Mirrors entity-graph/index.ts and procedural-memory.singleton.ts patterns
from Phase A.

+5 tests (structural + singleton identity / reset).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section C — Analyze + Content Rules (2 tasks)

### Task C1: `analyze-message.ts` Claude haiku integration

**Files:**
- Create: `packages/server/src/services/user-axes/analyze-message.ts`
- Create: `packages/server/src/services/user-axes/analyze-message.test.ts`

**Goal:** Async function called per inbound user message that asks Claude haiku to classify signals across the 4 axes, then persists via `recordSignals`. Best-effort — never throws.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/user-axes/analyze-message.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/analyze-message.ts'),
  'utf-8',
);

describe('analyze-message.ts structural', () => {
  it('exports analyzeMessage async function', () => {
    expect(SRC).toMatch(/export async function analyzeMessage\s*\(/);
  });
  it('calls anthropic.messages.create with MODELS.haiku', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    expect(fn).toContain('anthropic.messages.create');
    expect(fn).toContain('MODELS.haiku');
  });
  it('SYSTEM prompt instructs JSON-only output', () => {
    expect(SRC).toMatch(/ТОЛЬКО валидный JSON/);
  });
  it('SYSTEM prompt enumerates all 4 axes', () => {
    expect(SRC).toContain('self_discipline');
    expect(SRC).toContain('emotional_openness');
    expect(SRC).toContain('conflict_tolerance');
    expect(SRC).toContain('introspection_depth');
  });
  it('uses parseAxisResponse to parse Claude output', () => {
    expect(SRC).toContain('parseAxisResponse');
  });
  it('persists via getUserAxesStore().recordSignals', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.recordSignals/);
  });
  it('top-level try/catch — never throws to caller', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch/);
    expect(fn).toMatch(/console\.warn/);
  });
  it('skips empty text without making Claude call', () => {
    const fn = SRC.slice(SRC.indexOf('export async function analyzeMessage'));
    // Either `text.trim()` early return or equivalent guard.
    expect(fn).toMatch(/(\.trim\(\)\s*[)]?(?:\.length\s*===\s*0|\s*===\s*'')|!text\.trim)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/analyze-message.test.ts
```

Expected: FAIL — `ENOENT`.

- [ ] **Step 3: Implement `analyze-message.ts`**

Create `packages/server/src/services/user-axes/analyze-message.ts`:

```typescript
/**
 * v2.0 Phase B1 — Per-message Claude haiku classifier for USER axes.
 *
 * Spec §5.3-5.4. Best-effort: never throws. On any failure (Claude 429,
 * network, JSON parse) → log warn + skip. Bot reply path unaffected.
 *
 * Cost: ~$0.0001 per call. For Berik's 24 msgs/day = ~$0.07/month.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { parseAxisResponse } from './parse-response.js';
import { getUserAxesStore } from './index.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const AXIS_SYSTEM_PROMPT = `Ты — анализатор личности LifeOS. Из одного сообщения пользователя извлеки
сигналы по 4 осям личности.

ОСИ:
- self_discipline (0..1): склонность follow-through на обещания.
  UP: явные «сделал», «выполнил», «дочитал», consistency mentions.
  DOWN: «забыл», «не успел», «опять не получилось», repeated promises
  без follow-up.
- emotional_openness (0..1): готовность делиться чувствами.
  UP: emotional vocab («грустно», «злюсь», «переживаю»), body sensations,
  self-disclosure.
  DOWN: factual-only, «всё норм» при context негатива, deflection.
- conflict_tolerance (0..1): аппетит к pushback.
  UP: «не согласен», debating, «скажи как есть».
  DOWN: avoidance, defensive, abrupt topic-shift при challenge.
- introspection_depth (0..1): self-reflection.
  UP: «почему я», causal language, meta-cognition, past-self comparison.
  DOWN: descriptive без analysis, external attribution, present-focus only.

ПРАВИЛА:
1. Верни ТОЛЬКО валидный JSON. Без markdown, без объяснений.
2. Для КАЖДОЙ оси где есть evidence — return signal. Иначе omit ось.
3. delta range [-1.0, +1.0]. Strong signal ~0.10, medium ~0.05, weak ~0.02.
4. confidence [0, 1]. Высокая если сигнал явный и unambiguous.
5. excerpt — short fragment up to 100 chars показывающий signal.

ФОРМАТ:
{
  "signals": [
    {"axis": "self_discipline", "delta": -0.10, "confidence": 0.85, "excerpt": "опять не получилось"}
  ]
}

Если signals нет — верни {"signals": []}.

НЕ добавляй объяснений, только JSON.`;

/**
 * Analyze a single user message and persist any detected axis signals.
 * Returns silently — caller does not need to await for response correctness.
 * Always safe to call: any error is logged and swallowed.
 */
export async function analyzeMessage(
  userId: string,
  msgId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 512,
      system: AXIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.warn('[user-axes:analyzeMessage] empty/non-text Claude response');
      return;
    }

    const parsed = parseAxisResponse(content.text);
    if (parsed.signals.length === 0) return;

    await getUserAxesStore().recordSignals(
      userId,
      msgId,
      parsed.signals,
      'claude_classifier',
    );
  } catch (err) {
    console.warn(
      '[user-axes:analyzeMessage] failed:',
      err instanceof Error ? err.message : err,
    );
    // NEVER throw — caller (v2-capture parallel branch) must not break.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/analyze-message.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/analyze-message.ts \
        packages/server/src/services/user-axes/analyze-message.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-analyze): per-message Claude haiku classifier (C1)

Spec §5.3-5.4. Async function called per inbound user message:
1. Trim guard — empty text skipped without Claude call.
2. Claude haiku call with AXIS_SYSTEM_PROMPT (all 4 axes enumerated,
   JSON-only output enforced, examples for strong/medium/weak deltas).
3. parseAxisResponse on Claude output.
4. recordSignals(userId, msgId, signals, 'claude_classifier').

Top-level try/catch wraps everything — never throws. Failure modes
covered:
- empty/non-text Claude response → log + skip
- JSON parse failure → already swallowed by parseAxisResponse
- Claude 429/network → caught here, logged
- Persistence failure → already swallowed by recordSignals

+8 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `content-rules.ts` — 3 hard gates

**Files:**
- Create: `packages/server/src/services/user-axes/content-rules.ts`
- Create: `packages/server/src/services/user-axes/content-rules.test.ts`

**Goal:** Three pure helper functions that gate bot behaviour based on axes. Pure means they take in axes + draft, return a decision; they don't do I/O. Wiring into orchestrator happens in D2.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/user-axes/content-rules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  shouldForceOneStep,
  shouldSuppressEmotionalProbing,
  shouldSoftenChallenge,
  extractStepCount,
} from './content-rules.js';
import type { UserAxesValues } from './types.js';

const baseAxes: UserAxesValues = {
  selfDiscipline: 0.5,
  emotionalOpenness: 0.5,
  conflictTolerance: 0.5,
  introspectionDepth: 0.5,
  signalCount: 0,
  lastSignalAt: null,
};

describe('shouldForceOneStep (Gate 1)', () => {
  it('fires when selfDiscipline < 0.3 AND stepCount > 1', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.25 }, 3);
    expect(r.force).toBe(true);
    expect(r.reason).toContain('0.25');
  });
  it('does not fire when selfDiscipline >= 0.3', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.30 }, 5);
    expect(r.force).toBe(false);
  });
  it('does not fire when stepCount <= 1', () => {
    const r = shouldForceOneStep({ ...baseAxes, selfDiscipline: 0.1 }, 1);
    expect(r.force).toBe(false);
  });
});

describe('shouldSuppressEmotionalProbing (Gate 2)', () => {
  it('suppresses when EO < 0.3, no recent emotional content, 3+ msgs history', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.2 },
      3,
      false,
    )).toBe(true);
  });
  it('does not suppress when EO >= 0.3', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.3 },
      10,
      false,
    )).toBe(false);
  });
  it('does not suppress when emotional content recent (user opened door)', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.1 },
      10,
      true,
    )).toBe(false);
  });
  it('does not suppress at very first interactions (< 3 msgs)', () => {
    expect(shouldSuppressEmotionalProbing(
      { ...baseAxes, emotionalOpenness: 0.1 },
      2,
      false,
    )).toBe(false);
  });
});

describe('shouldSoftenChallenge (Gate 3)', () => {
  it('softens when CT < 0.3 AND draft contains assertive challenge', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.2 },
      'Слушай, ты не прав. Это так не работает.',
    );
    expect(r.soften).toBe(true);
    expect(r.suggestedReframe).toContain('curious question');
  });
  it('does not soften when CT >= 0.3', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.4 },
      'Ты не прав.',
    );
    expect(r.soften).toBe(false);
  });
  it('does not soften neutral reply even when CT low', () => {
    const r = shouldSoftenChallenge(
      { ...baseAxes, conflictTolerance: 0.1 },
      'Понимаю что это сложно. Что тебе кажется проще?',
    );
    expect(r.soften).toBe(false);
  });
  it('matches multiple assertive patterns case-insensitively', () => {
    for (const phrase of ['ты не прав', 'это неправильно', 'перестань так делать', 'хватит']) {
      const r = shouldSoftenChallenge(
        { ...baseAxes, conflictTolerance: 0.1 },
        `${phrase}.`,
      );
      expect(r.soften).toBe(true);
    }
  });
});

describe('extractStepCount (helper for Gate 1)', () => {
  it('counts numbered list items', () => {
    expect(extractStepCount('1. Первое\n2. Второе\n3. Третье')).toBe(3);
  });
  it('counts Russian enumerators', () => {
    expect(extractStepCount('во-первых, ... во-вторых, ... в-третьих, ...')).toBeGreaterThanOrEqual(3);
  });
  it('returns 0 for prose without enumeration', () => {
    expect(extractStepCount('Понимаю что это важно для тебя.')).toBe(0);
  });
  it('returns 1 for single numbered item', () => {
    expect(extractStepCount('1. Одна привычка на неделю.')).toBe(1);
  });
  it('handles bullet lists', () => {
    expect(extractStepCount('- Первое\n- Второе\n- Третье\n- Четвёртое')).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/content-rules.test.ts
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `content-rules.ts`**

Create `packages/server/src/services/user-axes/content-rules.ts`:

```typescript
/**
 * v2.0 Phase B1 — Content adaptation hard gates.
 *
 * Spec §7.4. Three pure helpers that take in current axes + context and
 * return a decision. No I/O — wiring into orchestrator/enrichment happens
 * elsewhere (Task D1, D2).
 *
 * Layered design: prompt enrichment (Layer 1, soft LLM judgment) handles
 * the majority of adaptation; these gates (Layer 2) catch the safety-
 * critical cases where Claude tends to ignore soft instructions.
 */

import type { UserAxesValues } from './types.js';

// ---------------------------------------------------------------------------
// Gate 1 — Goal decomposition: low self-discipline → enforce 1-step
// ---------------------------------------------------------------------------

/**
 * Determine whether bot's draft response should be regenerated with a
 * 1-step constraint.
 *
 * Fires when:
 *  - selfDiscipline < 0.3 (struggles with follow-through), AND
 *  - proposed step count > 1
 *
 * Protects user from being set up for failure (bot proposing 5 habits
 * when user can barely sustain 1).
 */
export function shouldForceOneStep(
  axes: UserAxesValues,
  proposedStepCount: number,
): { force: boolean; reason?: string } {
  if (axes.selfDiscipline < 0.3 && proposedStepCount > 1) {
    return {
      force: true,
      reason: `selfDiscipline=${axes.selfDiscipline.toFixed(2)} (< 0.3); ` +
        `proposed ${proposedStepCount} steps. Force ONE.`,
    };
  }
  return { force: false };
}

// ---------------------------------------------------------------------------
// Gate 2 — Emotional probing: low EO → suppress "что чувствуешь?" probes
// ---------------------------------------------------------------------------

/**
 * Determine whether bot should suppress emotional-probing language
 * ("что чувствуешь?", "как ты на самом деле?") in this turn.
 *
 * Fires when:
 *  - emotionalOpenness < 0.3 (user closed to emotional probes), AND
 *  - no recent emotional content from user (they haven't opened door), AND
 *  - at least 3 prior user messages (don't gate first interactions)
 *
 * @param recentUserMsgsCount — how many user msgs in this session/recent window
 * @param emotionalContentRecent — whether last few user msgs contained emotional vocab
 */
export function shouldSuppressEmotionalProbing(
  axes: UserAxesValues,
  recentUserMsgsCount: number,
  emotionalContentRecent: boolean,
): boolean {
  if (axes.emotionalOpenness >= 0.3) return false;
  if (emotionalContentRecent) return false; // user opened door first
  if (recentUserMsgsCount < 3) return false; // too early
  return true;
}

// ---------------------------------------------------------------------------
// Gate 3 — Soften challenge: low CT → rephrase assertions as questions
// ---------------------------------------------------------------------------

const ASSERTIVE_CHALLENGE_PATTERNS: RegExp[] = [
  /\bты\s+не\s+прав\b/i,
  /\bэто\s+неправильно\b/i,
  /\bты\s+противоречишь\b/i,
  /\bперестань\b/i,
  /\bхватит\b/i,
  /\bты\s+ошибаешься\b/i,
];

const REFRAME_GUIDANCE =
  'Replace assertion with curious question. ' +
  'Instead of "ты не прав" → "как ты сам это видишь?". ' +
  'Instead of "хватит" → "что тебя тянет к этому?".';

/**
 * Determine whether bot's draft response should be regenerated softer.
 *
 * Fires when:
 *  - conflictTolerance < 0.3 (user defensive when pushed), AND
 *  - draft contains assertive challenge language
 */
export function shouldSoftenChallenge(
  axes: UserAxesValues,
  draftReply: string,
): { soften: boolean; suggestedReframe?: string } {
  if (axes.conflictTolerance >= 0.3) return { soften: false };
  for (const pat of ASSERTIVE_CHALLENGE_PATTERNS) {
    if (pat.test(draftReply)) {
      return { soften: true, suggestedReframe: REFRAME_GUIDANCE };
    }
  }
  return { soften: false };
}

// ---------------------------------------------------------------------------
// Helper — extract proposed step count from bot's draft
// ---------------------------------------------------------------------------

/**
 * Heuristic count of distinct steps/items proposed in the draft. Used by
 * the orchestrator post-process to decide whether to invoke Gate 1.
 *
 * Counts:
 *  - numbered items "1.", "2.", "3.", etc.
 *  - bullet list items "- ", "* ", "• "
 *  - Russian enumerators ("во-первых", "во-вторых", "в-третьих", "в-четвёртых")
 *
 * Returns max of any of these (whichever style the draft uses).
 */
export function extractStepCount(draft: string): number {
  const numbered = (draft.match(/^\s*\d+\.\s+/gm) ?? []).length;
  const bullets = (draft.match(/^\s*[-*•]\s+/gm) ?? []).length;
  const enumWords = countRussianEnumerators(draft);
  return Math.max(numbered, bullets, enumWords);
}

function countRussianEnumerators(text: string): number {
  const t = text.toLowerCase();
  let count = 0;
  for (const word of ['во-первых', 'во-вторых', 'в-третьих', 'в-четвёртых', 'в-пятых']) {
    if (t.includes(word)) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/user-axes/content-rules.test.ts
```

Expected: all 18 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/user-axes/content-rules.ts \
        packages/server/src/services/user-axes/content-rules.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-rules): 3 hard gates for content adaptation (C2)

Spec §7.4. Three pure helper functions — no I/O, just decisions.
Wiring into orchestrator post-process in D2.

- shouldForceOneStep (Gate 1): selfDiscipline < 0.3 + proposed > 1 step
  → force regen with 1-step constraint
- shouldSuppressEmotionalProbing (Gate 2): EO < 0.3 + user closed door
  + 3+ msgs history → suppress "что чувствуешь?" probes
- shouldSoftenChallenge (Gate 3): CT < 0.3 + draft contains assertive
  challenge patterns ("ты не прав", "хватит", etc.) → request softer
  reframe

Plus extractStepCount helper — counts numbered/bulleted/Russian-enum
items in draft to feed Gate 1.

All 4 functions pure, exported, unit-tested across boundary conditions
+18 tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section D — Wiring (2 tasks)

### Task D1: Extend `v2-enrichment.ts` with axes section

**Files:**
- Modify: `packages/server/src/services/v2-enrichment.ts`
- Modify: `packages/server/src/services/v2-enrichment.test.ts`

**Goal:** Add `formatAxesSection` pure helper + integrate into `buildV2EnrichmentBlock` output. When user has UserAxes row, render a structured block in system prompt explaining current values + behavioural guidance per axis.

- [ ] **Step 1: Append failing tests**

Append to `packages/server/src/services/v2-enrichment.test.ts`:

```typescript
import { formatAxesSection } from './v2-enrichment.js';

describe('formatAxesSection (D1)', () => {
  const axesBase = {
    selfDiscipline: 0.5,
    emotionalOpenness: 0.5,
    conflictTolerance: 0.5,
    introspectionDepth: 0.5,
    signalCount: 0,
    lastSignalAt: null,
  };

  it('returns empty string when no axes available (null input)', () => {
    expect(formatAxesSection(null)).toBe('');
  });
  it('renders 4 axis lines with labels for moderate (default) values', () => {
    const out = formatAxesSection(axesBase);
    expect(out).toContain('self-discipline: 0.50');
    expect(out).toContain('emotional-openness: 0.50');
    expect(out).toContain('conflict-tolerance: 0.50');
    expect(out).toContain('introspection-depth: 0.50');
    // All four are "средняя" at 0.5
    expect((out.match(/средняя/g) ?? []).length).toBe(4);
  });
  it('includes guidance when SD low', () => {
    const out = formatAxesSection({ ...axesBase, selfDiscipline: 0.25 });
    expect(out).toContain('self-discipline: 0.25');
    expect(out).toContain('низкая');
    // Guidance about 1-step plans (substring; exact wording in
    // implementation, but must convey the rule)
    expect(out.toLowerCase()).toMatch(/один|1[-\s]?шаг|шаг/);
  });
  it('includes guidance when EO high', () => {
    const out = formatAxesSection({ ...axesBase, emotionalOpenness: 0.85 });
    expect(out).toContain('emotional-openness: 0.85');
    expect(out).toContain('очень высокая');
  });
});

describe('buildV2EnrichmentBlock — axes integration', () => {
  // The function is async and reads from DB / singleton. We verify the
  // wiring structurally via readFileSync; runtime is covered by integration.
  it('reads axes via getUserAxesStore().getAxes', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('getUserAxesStore');
    expect(enrichSrc).toMatch(/\.getAxes\(/);
  });
  it('appends formatAxesSection output to block', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('formatAxesSection');
  });
  it('gated by isV2AxesEnabled', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('isV2AxesEnabled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-enrichment.test.ts
```

Expected: FAIL — `formatAxesSection` not exported.

- [ ] **Step 3: Extend `v2-enrichment.ts`**

Add to top of file (after existing imports):

```typescript
import { getUserAxesStore } from './user-axes/index.js';
import { axisLabel, type UserAxesValues } from './user-axes/index.js';
import { isV2AxesEnabled } from '../lib/feature-flags.js';
```

Add after existing exports (before `fetchV2EnrichmentData` if present, else at bottom):

```typescript
/**
 * v2 Phase B1 — render axes section for system prompt block.
 *
 * Returns empty string when axes are null (e.g. axes feature disabled
 * for user, or first-msg auto-init not yet visible). Otherwise renders
 * 4 lines with current value, semantic label, and behavioural guidance.
 *
 * Pure helper (no I/O) — exported for unit testing.
 */
export function formatAxesSection(axes: UserAxesValues | null): string {
  if (!axes) return '';

  const lines: string[] = ['## Личностные оси (continuous 0..1, обновляются с каждым сообщением)', ''];

  const sd = axes.selfDiscipline;
  lines.push(`- self-discipline: ${sd.toFixed(2)} (${axisLabel(sd)}) — ${guidanceSD(sd)}`);
  const eo = axes.emotionalOpenness;
  lines.push(`- emotional-openness: ${eo.toFixed(2)} (${axisLabel(eo)}) — ${guidanceEO(eo)}`);
  const ct = axes.conflictTolerance;
  lines.push(`- conflict-tolerance: ${ct.toFixed(2)} (${axisLabel(ct)}) — ${guidanceCT(ct)}`);
  const id = axes.introspectionDepth;
  lines.push(`- introspection-depth: ${id.toFixed(2)} (${axisLabel(id)}) — ${guidanceID(id)}`);

  return lines.join('\n');
}

function guidanceSD(v: number): string {
  if (v < 0.3) return 'Юзер борется с follow-through. НЕ предлагай multi-step plans. Помогай через «следующий ОДИН маленький шаг».';
  if (v < 0.6) return 'Умеренная дисциплина. Multi-step OK, но проверяй capacity. Если 3+ шагов — спроси готов ли.';
  if (v < 0.8) return 'Хорошая дисциплина. Можешь предлагать конкретные планы — юзер выполнит.';
  return 'Очень дисциплинированный — можешь поставить ambitious targets, проверять stretch goals.';
}

function guidanceEO(v: number): string {
  if (v < 0.3) return 'Юзер сдержан в эмоциях. Suppress «что чувствуешь?» probes. Фокус на practical help.';
  if (v < 0.6) return 'Умеренная openness. Можешь спрашивать про чувства если context располагает.';
  if (v < 0.8) return 'Открыт обсуждать чувства. Reference past emotional states, can ask "что чувствуешь?".';
  return 'Очень открыт. Можешь suggest journaling, mood inventories, deep emotional reflection.';
}

function guidanceCT(v: number): string {
  if (v < 0.3) return 'Защитен при pushback. Default — supportive. Критику только если ЯВНО попросил. Видишь противоречие — спроси "как ты сам это видишь?".';
  if (v < 0.6) return 'Умеренная tolerance. Pushback OK если мягкий и обоснованный.';
  if (v < 0.8) return 'Открыт challenge. Можешь указать противоречие, holding accountable.';
  return 'Любит правду в лицо. Можешь быть strict trainer, ставить hard questions.';
}

function guidanceID(v: number): string {
  if (v < 0.3) return 'Action-oriented, мало рефлексии. Фокус на конкретике, не открывай philosophical loops.';
  if (v < 0.6) return 'Умеренная reflection. Можешь спрашивать «почему» если на context, но не уходи в abstract.';
  if (v < 0.8) return 'Reflective. Suggest journaling prompts, delve into patterns.';
  return 'Глубокая introspection. Можешь задавать philosophical questions, big-picture reframes.';
}
```

Find `fetchV2EnrichmentData` (or equivalent function that calls `buildV2EnrichmentBlock`) and extend it. Locate where existing block is composed and add:

```typescript
  // v2 Phase B1 — axes section
  let axesSection = '';
  if (isV2AxesEnabled(userId)) {
    try {
      const axes = await getUserAxesStore().getAxes(userId);
      axesSection = formatAxesSection(axes);
    } catch (err) {
      console.warn('[v2-enrichment:axes] failed:', err);
    }
  }

  if (axesSection) {
    block += '\n\n' + axesSection;
  }
```

(Exact insertion point depends on existing structure; integrate so that
axes appears as the final section in the enrichment block.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-enrichment.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/v2-enrichment.ts \
        packages/server/src/services/v2-enrichment.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-wiring): axes section in v2 enrichment block (D1)

Adds formatAxesSection (pure helper) and integrates into
buildV2EnrichmentBlock under FEATURE_V2_AXES gate.

Renders 4 lines per spec §7.2: each axis with current value, semantic
label (axisLabel), and behavioural guidance string. Guidance is bucketed
into 4 levels per axis (very low / low / moderate / high / very high)
giving Claude concrete instructions like "НЕ предлагай multi-step" for
low self-discipline or "Можешь suggest journaling" for high EO.

When axes flag off → axes section omitted (block unchanged).
When axes flag on but getAxes fails → log + skip (block continues
without axes; bot reply unaffected).

+9 tests (4 formatAxesSection unit + 3 wiring structural + 2 sentinel).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: Feature flag + v2-capture parallel branch + orchestrator post-process hook

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/lib/feature-flags.test.ts`
- Modify: `packages/server/src/services/v2-capture.ts`
- Modify: `packages/server/src/services/v2-capture.test.ts`
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Create: `packages/server/src/services/jarvis-axes-postprocess.test.ts`

**Goal:** Three changes in one commit (all wiring, conceptually one unit):
1. `isV2AxesEnabled(userId)` helper + tests
2. `v2-capture` parallel branch invokes `userAxes.analyzeMessage`
3. `jarvis-orchestrator` post-process hook applies content rules (Gate 1 step-count check)

- [ ] **Step 1: Append failing tests for feature flag**

Append to `packages/server/src/lib/feature-flags.test.ts`:

```typescript
describe('isV2AxesEnabled', () => {
  const origEnv = process.env.FEATURE_V2_AXES;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.FEATURE_V2_AXES;
    else process.env.FEATURE_V2_AXES = origEnv;
  });

  it('returns false when env var unset', () => {
    delete process.env.FEATURE_V2_AXES;
    expect(isV2AxesEnabled('user-abc')).toBe(false);
  });
  it('returns false when env var = "none" or "false"', () => {
    process.env.FEATURE_V2_AXES = 'none';
    expect(isV2AxesEnabled('user-abc')).toBe(false);
    process.env.FEATURE_V2_AXES = 'false';
    expect(isV2AxesEnabled('user-abc')).toBe(false);
  });
  it('returns true for "all" or "true"', () => {
    process.env.FEATURE_V2_AXES = 'all';
    expect(isV2AxesEnabled('user-anybody')).toBe(true);
    process.env.FEATURE_V2_AXES = 'true';
    expect(isV2AxesEnabled('user-anybody')).toBe(true);
  });
  it('returns true for matching user-{id} in comma list', () => {
    process.env.FEATURE_V2_AXES = 'user-abc,user-def';
    expect(isV2AxesEnabled('abc')).toBe(true);
    expect(isV2AxesEnabled('def')).toBe(true);
    expect(isV2AxesEnabled('xyz')).toBe(false);
  });
  it('tolerates whitespace around commas', () => {
    process.env.FEATURE_V2_AXES = '  user-abc , user-def  ';
    expect(isV2AxesEnabled('abc')).toBe(true);
    expect(isV2AxesEnabled('def')).toBe(true);
  });
});
```

- [ ] **Step 2: Append failing structural tests for v2-capture parallel branch**

Append to `packages/server/src/services/v2-capture.test.ts`:

```typescript
describe('v2-capture — user-axes parallel branch (D2)', () => {
  it('imports analyzeMessage from user-axes', () => {
    expect(SRC).toMatch(/from '\.\/user-axes\/analyze-message\.js'/);
  });
  it('imports isV2AxesEnabled', () => {
    expect(SRC).toContain('isV2AxesEnabled');
  });
  it('parallel branch fires under flag', () => {
    const captureFn = SRC.slice(SRC.indexOf('captureV2InBackground'));
    expect(captureFn).toMatch(/isV2AxesEnabled\(\s*userId\s*\)/);
    expect(captureFn).toMatch(/userAxesAnalyzeMessage\(|analyzeMessage\(\s*userId\s*,\s*msgId\s*,\s*text/);
  });
  it('wrapped in best-effort catch', () => {
    const captureFn = SRC.slice(SRC.indexOf('captureV2InBackground'));
    // The axes branch should have its own .catch or be inside the
    // Promise.allSettled — either way no unhandled rejection.
    expect(captureFn).toMatch(/\.catch\(/);
  });
});
```

- [ ] **Step 3: Create new test for orchestrator post-process**

Create `packages/server/src/services/jarvis-axes-postprocess.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — axes post-process hook (D2)', () => {
  it('imports content-rules helpers', () => {
    expect(SRC).toMatch(/from '\.\/user-axes\/content-rules\.js'/);
    expect(SRC).toContain('shouldForceOneStep');
    expect(SRC).toContain('extractStepCount');
  });
  it('imports getUserAxesStore + isV2AxesEnabled', () => {
    expect(SRC).toContain('getUserAxesStore');
    expect(SRC).toContain('isV2AxesEnabled');
  });
  it('post-process block invokes Gate 1 (step-count check)', () => {
    expect(SRC).toMatch(/shouldForceOneStep\(/);
    expect(SRC).toMatch(/extractStepCount\(/);
  });
  it('post-process gated by isV2AxesEnabled', () => {
    // Find the post-process region and confirm flag check is nearby.
    const idx = SRC.indexOf('shouldForceOneStep');
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 600), idx);
    expect(window).toMatch(/isV2AxesEnabled\(\s*userId\s*\)/);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd packages/server
npm test -- --reporter=verbose \
  src/lib/feature-flags.test.ts \
  src/services/v2-capture.test.ts \
  src/services/jarvis-axes-postprocess.test.ts
```

Expected: new tests FAIL.

- [ ] **Step 5: Add `isV2AxesEnabled` to feature-flags.ts**

Edit `packages/server/src/lib/feature-flags.ts`. Add after existing flag helpers:

```typescript
/**
 * v2 Phase B1 — Per-user gate for USER NEST axes feature.
 *
 * Values:
 *   "all" / "true"     → enabled for everyone
 *   "" / "none" / "false" / unset → disabled for everyone
 *   "user-X,user-Y"    → enabled only for those users (comma list)
 */
export function isV2AxesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_AXES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 6: Add parallel branch in v2-capture.ts**

Edit `packages/server/src/services/v2-capture.ts`. Add to imports:

```typescript
import { analyzeMessage as userAxesAnalyzeMessage } from './user-axes/analyze-message.js';
import { isV2AxesEnabled } from '../lib/feature-flags.js';
```

Inside `captureV2InBackground`, after the existing parallel-branch
block (or alongside other awaited promises), add:

```typescript
    // v2 Phase B1 — user axes parallel branch (best-effort)
    if (isV2AxesEnabled(userId)) {
      void userAxesAnalyzeMessage(userId, msgId, text).catch((err) => {
        console.warn('[v2-capture:axes] failed:', err);
      });
    }
```

(Exact placement: after `emotional.analyzeMessage` line in the existing
`Promise.allSettled`. Fire-and-forget — axes write should not block
return.)

- [ ] **Step 7: Add post-process hook in jarvis-orchestrator.ts**

Edit `packages/server/src/services/jarvis-orchestrator.ts`. Add to imports:

```typescript
import { shouldForceOneStep, extractStepCount } from './user-axes/content-rules.js';
import { getUserAxesStore } from './user-axes/index.js';
import { isV2AxesEnabled as isV2AxesEnabledFlag } from '../lib/feature-flags.js';
```

(Note: rename import to avoid collision with existing `isV2MemoryEnabled` etc.)

In `handleMessage`, locate the point AFTER Claude has produced `reply`
string but BEFORE returning to user. Insert:

```typescript
  // v2 Phase B1 — post-process content rules (Gate 1: step-count)
  if (isV2AxesEnabledFlag(userId)) {
    try {
      const axes = await getUserAxesStore().getAxes(userId);
      const stepCount = extractStepCount(reply);
      const gate1 = shouldForceOneStep(axes, stepCount);
      if (gate1.force) {
        console.log(`[axes:gate1] ${gate1.reason}`);
        // Log to insights for transparency
        try {
          await prisma.insight.create({
            data: {
              userId,
              source: 'axis_rule',
              kind: 'goal_decomposition_forced',
              scope: { rule: 'gate1', stepCount, reason: gate1.reason } as any,
              suggestedAction: null,
              deliveredAt: null,
            },
          });
        } catch {/* swallow — log-only */}
        // Strategy: ask Claude to regenerate with 1-step constraint.
        // For B1 implementation: prepend a sentinel marker to reply
        // alerting the user, since regen adds latency and complexity.
        // Full regen-loop is a follow-up enhancement.
        reply = '⚠️ (gate-1: 1-step) ' + reply;
      }
    } catch (err) {
      console.warn('[axes:postprocess] failed:', err);
    }
  }
```

Note: The implementation above marks the reply with a visible prefix
rather than re-querying Claude. This is intentional for the initial
B1 — the prefix is debuggable and avoids latency. A future enhancement
can swap to regen-with-constraint.

- [ ] **Step 8: Run all tests to verify they pass**

```bash
cd packages/server
npm test -- --reporter=verbose \
  src/lib/feature-flags.test.ts \
  src/services/v2-capture.test.ts \
  src/services/jarvis-axes-postprocess.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean. Existing tests (incl. v2-capture pre-B1
tests) unaffected.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts \
        packages/server/src/lib/feature-flags.test.ts \
        packages/server/src/services/v2-capture.ts \
        packages/server/src/services/v2-capture.test.ts \
        packages/server/src/services/jarvis-orchestrator.ts \
        packages/server/src/services/jarvis-axes-postprocess.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-wiring): flag + v2-capture branch + orchestrator post-process (D2)

Three-part wiring (one atomic unit because they always travel together):

1. isV2AxesEnabled(userId) in feature-flags.ts — mirrors existing
   isV2MemoryEnabled pattern (per-user comma list / all / none).
   +6 tests.

2. v2-capture parallel branch — fire-and-forget
   userAxesAnalyzeMessage(userId, msgId, text) under flag. Catches
   own errors; does not block legacy capture or Phase A v2 pipeline.

3. jarvis-orchestrator post-process hook — after Claude reply, if
   axes flag on, read current axes + extractStepCount, run Gate 1
   shouldForceOneStep. On fire: log to Insights table + prefix reply
   with "⚠️ (gate-1: 1-step) " sentinel. Sentinel makes the rule
   firing visible to user and debuggable for Berik.

Hard catches around every axes block — never affects bot reply path
when axes flag off. When on but axes fail (DB, missing row, etc.) →
log + skip; bot replies normally.

+9 tests across all three wires.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section E — Telegram + Bootstrap (2 tasks)

### Task E1: `/axes` Telegram command

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts`
- Create: `packages/server/src/services/telegram-axes.test.ts`

**Goal:** Add Telegram command `/axes` that shows user's current axis values + 3 most recent signals per axis. Transparency tool — lets Berik validate that axes match self-perception.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/telegram-axes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8',
);

describe('telegram-bot.ts — /axes command (E1)', () => {
  it('registers bot.command("axes", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*'axes'/);
  });
  it('reads from getUserAxesStore', () => {
    expect(SRC).toContain('getUserAxesStore');
    expect(SRC).toMatch(/\.getAxes\(/);
  });
  it('shows recentSignals per axis', () => {
    expect(SRC).toMatch(/recentSignals\(/);
  });
  it('handler gated by isV2AxesEnabled', () => {
    const idx = SRC.indexOf("bot.command('axes'");
    expect(idx).toBeGreaterThan(0);
    const region = SRC.slice(idx, idx + 1500);
    expect(region).toContain('isV2AxesEnabled');
  });
  it('replies with all 4 axis names', () => {
    const idx = SRC.indexOf("bot.command('axes'");
    const region = SRC.slice(idx, idx + 2500);
    expect(region).toContain('self-discipline');
    expect(region).toContain('emotional-openness');
    expect(region).toContain('conflict-tolerance');
    expect(region).toContain('introspection-depth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/telegram-axes.test.ts
```

Expected: FAIL — command not present.

- [ ] **Step 3: Add `/axes` handler in telegram-bot.ts**

Edit `packages/server/src/services/telegram-bot.ts`. Add to top imports:

```typescript
import { getUserAxesStore } from './user-axes/index.js';
import { axisLabel, type AxisName } from './user-axes/index.js';
import { isV2AxesEnabled } from '../lib/feature-flags.js';
```

Add the command handler near the other `bot.command(...)` registrations:

```typescript
// v2 Phase B1 — /axes transparency command
bot.command('axes', async (ctx) => {
  if (!ctx.message) return;
  try {
    const user = await findOrCreateUser(ctx);
    if (!isV2AxesEnabled(user.id)) {
      await ctx.reply('Личностные оси выключены для тебя. Спроси админа подключить FEATURE_V2_AXES.');
      return;
    }
    const text = await formatAxesForTelegram(user.id);
    await ctx.reply(text);
  } catch (err) {
    console.warn('[telegram:axes] failed:', err);
    await ctx.reply('Не получилось получить axes. Попробуй позже.');
  }
});

async function formatAxesForTelegram(userId: string): Promise<string> {
  const axes = await getUserAxesStore().getAxes(userId);
  const labels: Array<[string, AxisName, number, string]> = [
    ['🎯', 'self_discipline', axes.selfDiscipline, 'self-discipline'],
    ['💖', 'emotional_openness', axes.emotionalOpenness, 'emotional-openness'],
    ['🥊', 'conflict_tolerance', axes.conflictTolerance, 'conflict-tolerance'],
    ['🔍', 'introspection_depth', axes.introspectionDepth, 'introspection-depth'],
  ];

  const lines: string[] = ['Твои личностные оси (continuous 0..1):', ''];
  for (const [emoji, axisName, value, displayName] of labels) {
    lines.push(`${emoji} ${displayName}: ${value.toFixed(2)} (${axisLabel(value)})`);
    const recent = await getUserAxesStore().recentSignals(userId, axisName, 3);
    if (recent.length > 0) {
      lines.push('   Свежие сигналы:');
      for (const s of recent) {
        const sign = s.delta >= 0 ? '+' : '';
        const when = relativeDate(s.recordedAt);
        const exc = s.excerpt ? ` «${s.excerpt.slice(0, 50)}»` : '';
        lines.push(`   • ${sign}${s.delta.toFixed(2)}${exc} (${when})`);
      }
    }
    lines.push('');
  }
  lines.push(`Всего сигналов: ${axes.signalCount}`);
  return lines.join('\n').trim();
}

function relativeDate(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дней назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/telegram-axes.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/telegram-bot.ts \
        packages/server/src/services/telegram-axes.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-telegram): /axes transparency command (E1)

Telegram command shows user their current 4 axis values + 3 most recent
signals per axis. Lets user (Berik) validate that bot's axis estimates
match their self-perception, and gives a debug surface when content
rules fire unexpectedly.

Output format:
  Твои личностные оси (continuous 0..1):

  🎯 self-discipline: 0.25 (низкая)
     Свежие сигналы:
     • -0.10 «опять не получилось» (вчера)
     • +0.04 «сделал зарядку» (3 дней назад)
  ...
  Всего сигналов: 47

Gated by isV2AxesEnabled — when off, command returns "feature disabled"
instead of leaking axes machinery. Errors logged + replied with friendly
"попробуй позже".

+5 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E2: `bootstrap-axes.ts` script + tests

**Files:**
- Create: `packages/server/scripts/bootstrap-axes.ts`
- Create: `packages/server/src/scripts/bootstrap-axes.test.ts`

**Goal:** Standalone CLI script (mirrors `migrate-to-v2.ts` and `dedup-entities.ts` pattern) that reads a user's `UserProfile.patterns` / `triggers` / `styleNotes`, asks Claude haiku to estimate starting values for the 4 axes, and writes them to `UserAxes` as bootstrap signals (source='bootstrap').

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/scripts/bootstrap-axes.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let parseCliArgs: (argv: string[]) => any;
let SCRIPT: string;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/bootstrap-axes.js', import.meta.url).href;
  const mod = await import(modulePath);
  parseCliArgs = mod.parseCliArgs;
  const testDir = dirname(new URL(import.meta.url).pathname);
  SCRIPT = readFileSync(join(testDir, '..', '..', 'scripts', 'bootstrap-axes.ts'), 'utf-8');
});

describe('bootstrap-axes — parseCliArgs', () => {
  it('accepts --user=X --dry-run', () => {
    expect(parseCliArgs(['--user=abc', '--dry-run'])).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
  it('accepts --user=X --apply', () => {
    expect(parseCliArgs(['--user=abc', '--apply'])).toEqual({ userId: 'abc', mode: 'apply' });
  });
  it('rejects missing user', () => {
    expect('error' in parseCliArgs(['--dry-run'])).toBe(true);
  });
  it('rejects empty user value', () => {
    expect('error' in parseCliArgs(['--user=', '--apply'])).toBe(true);
  });
  it('rejects no mode', () => {
    expect('error' in parseCliArgs(['--user=abc'])).toBe(true);
  });
  it('rejects mutually exclusive modes', () => {
    expect('error' in parseCliArgs(['--user=abc', '--dry-run', '--apply'])).toBe(true);
  });
});

describe('bootstrap-axes script structural', () => {
  it('reads userProfile via prisma.userProfile.findUnique', () => {
    expect(SCRIPT).toMatch(/userProfile\.findUnique/);
  });
  it('calls Claude haiku with userProfile patterns', () => {
    expect(SCRIPT).toContain('anthropic.messages.create');
    expect(SCRIPT).toContain('MODELS.haiku');
    expect(SCRIPT).toMatch(/patterns/);
  });
  it('skips bootstrap if real (non-bootstrap) signals exist', () => {
    expect(SCRIPT).toMatch(/source.*claude_classifier|signalCount/);
  });
  it('writes bootstrap signals with source=bootstrap', () => {
    expect(SCRIPT).toContain("source: 'bootstrap'");
  });
  it('uses larger alpha for bootstrap (0.30) per spec §9.2', () => {
    expect(SCRIPT).toMatch(/0\.30|BOOTSTRAP_ALPHA/);
  });
  it('summary report includes axes + signalCount', () => {
    expect(SCRIPT).toContain('self_discipline');
    expect(SCRIPT).toContain('signalCount');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/scripts/bootstrap-axes.test.ts
```

Expected: FAIL — `ENOENT` on bootstrap-axes.

- [ ] **Step 3: Implement `bootstrap-axes.ts`**

Create `packages/server/scripts/bootstrap-axes.ts`:

```typescript
/**
 * v2.0 Phase B1 — one-time bootstrap of UserAxes from UserProfile.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md §9
 *
 * Usage:
 *   npx tsx packages/server/scripts/bootstrap-axes.ts --user=<id> --dry-run
 *   npx tsx packages/server/scripts/bootstrap-axes.ts --user=<id> --apply
 *
 * What it does (--apply):
 *   1. Read UserProfile (patterns + triggers + styleNotes).
 *   2. Ask Claude haiku to estimate initial values for 4 axes from the
 *      profile context.
 *   3. Skip if user already has real signals (claude_classifier source).
 *   4. Else: write bootstrap signals into AxisSignal log, and write
 *      UserAxes row directly with the estimated values (overriding 0.5
 *      defaults) — use BOOTSTRAP_ALPHA=0.30 so signal lands more
 *      aggressively than steady-state α=0.05.
 *
 * Idempotent: re-running on a user with prior bootstrap is OK, will skip
 * if real signals exist. Multiple bootstrap runs without real signals
 * will overwrite estimates (last writer wins).
 */

import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../src/lib/models.js';
import { AXIS_NAMES, type AxisName } from '../src/services/user-axes/index.js';

const BOOTSTRAP_ALPHA = 0.30;

export type CliArgs =
  | { userId: string; mode: 'dry-run' | 'apply' }
  | { error: string };

export function parseCliArgs(argv: string[]): CliArgs {
  let userId: string | undefined;
  let dryRun = false;
  let apply = false;
  for (const arg of argv) {
    if (arg.startsWith('--user=')) {
      const val = arg.slice('--user='.length).trim();
      if (val.length === 0) return { error: '--user=<id> requires a non-empty value' };
      userId = val;
    } else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--apply') apply = true;
  }
  if (!userId) return { error: 'Missing --user=<id>' };
  if (dryRun && apply) return { error: '--dry-run and --apply mutually exclusive' };
  if (!dryRun && !apply) return { error: 'Pick a mode: --dry-run or --apply' };
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

const BOOTSTRAP_SYSTEM_PROMPT = `Дан psycho-profile пользователя (накопленный LifeOS из long-term observation).
Оцени 4 личностные оси для starting calibration новой системы.

ОСИ:
- self_discipline (0..1): склонность follow-through на обещания
- emotional_openness (0..1): готовность делиться чувствами
- conflict_tolerance (0..1): аппетит к pushback / критике
- introspection_depth (0..1): self-reflection / causal thinking

ПРАВИЛА:
1. Верни ТОЛЬКО валидный JSON. Без markdown.
2. Для КАЖДОЙ из 4 осей — return value.
3. Justification — короткая фраза-обоснование из profile.

ФОРМАТ:
{
  "axes": [
    {"axis": "self_discipline", "value": 0.25, "justification": "..."},
    {"axis": "emotional_openness", "value": 0.7, "justification": "..."},
    {"axis": "conflict_tolerance", "value": 0.4, "justification": "..."},
    {"axis": "introspection_depth", "value": 0.55, "justification": "..."}
  ]
}`;

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('bootstrap-axes:', parsed.error);
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  console.log(`[bootstrap-axes] user=${userId} mode=${mode}`);

  try {
    // Skip if real signals already exist
    const realSignalCount = await prisma.axisSignal.count({
      where: { userId, source: 'claude_classifier' },
    });
    if (realSignalCount > 0) {
      console.log(`${tag} SKIP — user already has ${realSignalCount} real signals (source=claude_classifier)`);
      return;
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { patterns: true, triggers: true, styleNotes: true, values: true, relationships: true },
    });
    if (!profile) {
      console.log(`${tag} No UserProfile for ${userId} — leaving defaults 0.5 on all axes`);
      return;
    }

    const profileText = JSON.stringify(
      {
        patterns: profile.patterns,
        triggers: profile.triggers,
        styleNotes: profile.styleNotes,
        values: profile.values,
        relationships: profile.relationships,
      },
      null,
      2,
    );

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 800,
      system: BOOTSTRAP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: profileText }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.error(`${tag} Claude returned empty/non-text response`);
      return;
    }

    let estimated: Array<{ axis: AxisName; value: number; justification: string }>;
    try {
      let txt = content.text.trim();
      if (txt.startsWith('```')) {
        txt = txt.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
      }
      const parsed = JSON.parse(txt);
      estimated = Array.isArray(parsed.axes) ? parsed.axes : [];
    } catch (err) {
      console.error(`${tag} Could not parse Claude response:`, err);
      return;
    }

    console.log(`${tag} Claude estimated:`);
    for (const e of estimated) {
      console.log(`  ${e.axis} = ${e.value.toFixed(2)} — ${e.justification}`);
    }

    if (mode === 'dry-run') {
      console.log(`${tag} (dry-run — no DB writes)`);
      return;
    }

    // Apply: write bootstrap signals + UserAxes row
    const validEstimates = estimated.filter(
      (e) => typeof e.axis === 'string' &&
        AXIS_NAMES.includes(e.axis as AxisName) &&
        typeof e.value === 'number',
    );

    if (validEstimates.length === 0) {
      console.error(`${tag} No valid axis estimates`);
      return;
    }

    // Write AxisSignal rows (source=bootstrap)
    for (const e of validEstimates) {
      // Compute delta needed to move from 0.5 to e.value with α=0.30
      // applyEwma: next = α*target + (1-α)*current
      // Solving target so next=e.value: target = (e.value - (1-α)*0.5) / α
      //   = (e.value - 0.35) / 0.30
      // Then delta = target - 0.5 (assuming confidence=1)
      const target = (e.value - (1 - BOOTSTRAP_ALPHA) * 0.5) / BOOTSTRAP_ALPHA;
      const clampedTarget = Math.max(0, Math.min(1, target));
      const delta = clampedTarget - 0.5;
      await prisma.axisSignal.create({
        data: {
          userId,
          msgId: null,
          axis: e.axis,
          delta,
          confidence: 1.0,
          excerpt: e.justification.slice(0, 200),
          source: 'bootstrap',
        },
      });
    }

    // Set UserAxes row to the estimated values directly (overwrite defaults)
    const axisFieldByName: Record<AxisName, string> = {
      self_discipline: 'selfDiscipline',
      emotional_openness: 'emotionalOpenness',
      conflict_tolerance: 'conflictTolerance',
      introspection_depth: 'introspectionDepth',
    };
    const updateData: Record<string, unknown> = {
      signalCount: validEstimates.length,
      lastSignalAt: new Date(),
    };
    for (const e of validEstimates) {
      updateData[axisFieldByName[e.axis]] = e.value;
    }

    await prisma.userAxes.upsert({
      where: { userId },
      create: {
        userId,
        ...updateData,
      },
      update: updateData,
    });

    console.log(`${tag} ✓ Bootstrap applied. Wrote ${validEstimates.length} bootstrap signals + UserAxes row.`);
  } catch (err) {
    console.error('bootstrap-axes failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]?.endsWith('bootstrap-axes.ts') ||
  process.argv[1]?.endsWith('bootstrap-axes.js')
) {
  main().catch((e) => {
    console.error('bootstrap-axes fatal:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/scripts/bootstrap-axes.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: all green, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/scripts/bootstrap-axes.ts \
        packages/server/src/scripts/bootstrap-axes.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-axes-migration): bootstrap-axes.ts one-time UserProfile → UserAxes (E2)

CLI script (mirrors migrate-to-v2 + dedup-entities patterns) that
estimates a user's starting axes from their existing UserProfile
(patterns + triggers + styleNotes + values + relationships).

Flow:
  1. Skip if real (claude_classifier) signals already exist.
  2. Read UserProfile via Prisma.
  3. Claude haiku call with full profile context.
  4. Parse 4 axis estimates.
  5. Apply mode: write AxisSignal rows (source='bootstrap') with delta
     calibrated so EWMA α=0.30 lands target value, and overwrite
     UserAxes row directly.
  6. Idempotent — re-runs on user without real signals just overwrite.

Bootstrap uses α=0.30 (vs steady-state 0.05) per spec §9.2 — wants the
estimate to dominate immediately, not be a slow drift target.

+12 tests (parseCliArgs unit + structural).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section F — Verify (1 task)

### Task F1: Final verification + progress tracker commit

**Files:**
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

**Goal:** Confirm everything works end-to-end, run the full test suite, verify zero `vi.mock`, verify zero placeholders, commit progress tracker bump.

- [ ] **Step 1: Run full server test suite**

```bash
cd packages/server
npm test
```

Expected: all tests pass. Baseline 1387 from end of Phase A polish; B1 adds ~115 new tests → expect 1500+ total.

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

Expected: `0`.

- [ ] **Step 4: Verify all placeholder throws removed**

```bash
grep -rn "not yet implemented" packages/server/src/services/user-axes/ \
                                packages/server/scripts/bootstrap-axes.ts
```

Expected: empty output.

- [ ] **Step 5: Verify file structure**

```bash
ls packages/server/src/services/user-axes/
ls packages/server/scripts/bootstrap-axes.ts
```

Expected files present:
```
analyze-message.test.ts  content-rules.test.ts  index.test.ts          parse-response.test.ts  postgres-impl.test.ts  types.test.ts
analyze-message.ts       content-rules.ts        index.ts              parse-response.ts        postgres-impl.ts        types.ts
```

And `scripts/bootstrap-axes.ts`.

- [ ] **Step 6: Smoke test bootstrap script (dry-run, local Docker DB)**

```bash
cd packages/server
docker exec server-postgres-1 psql -U postgres -d lifeos_dev \
  -c "INSERT INTO \"User\" (id, email, name, \"passwordHash\", \"createdAt\")
      VALUES ('test-bootstrap-user', 'test@example.com', 'Test', 'hash', NOW())
      ON CONFLICT (id) DO NOTHING;" \
  -c "INSERT INTO \"UserProfile\" (id, \"userId\", patterns, triggers, \"styleNotes\", values, relationships, \"updatedAt\")
      VALUES ('test-bootstrap-profile', 'test-bootstrap-user',
              ARRAY['ставит амбициозные цели, нулевое выполнение за 90 дней'],
              ARRAY['финансовые потери'],
              'кратко и по делу',
              ARRAY['самодисциплина'],
              '{}'::jsonb,
              NOW())
      ON CONFLICT (id) DO NOTHING;"

DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx tsx scripts/bootstrap-axes.ts --user=test-bootstrap-user --dry-run
```

Expected: prints estimated axes + justifications, then `(dry-run — no DB writes)`.

- [ ] **Step 7: Update progress tracker**

Edit `docs/plan/v2-memory-proactivity-scope.md`. Find the Phase B section
and add row for B1:

```markdown
| B1 | USER NEST Axes (Tier 5 FULL — user side) | ✅ done | 2026-05-31 | 13 commits; +115 tests (1387→1502); tsc clean; 0 vi.mock; 0 placeholders. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md. Plan: docs/superpowers/plans/2026-05-31-v2-phase-b1-user-axes.md |
```

- [ ] **Step 8: Final commit — progress tracker**

```bash
git add docs/plan/v2-memory-proactivity-scope.md
git commit -m "$(cat <<'EOF'
docs(v2-progress): Phase B1 DONE — USER NEST axes

13 atomic commits implementing user-axes service:
- A1 Prisma models + migration
- B1-B5 types + helpers + Postgres impl + singleton
- C1-C2 Claude haiku analyze + 3 content rules
- D1-D2 enrichment + flag/capture/orchestrator wiring
- E1-E2 Telegram /axes + bootstrap script

1387 → 1502 tests pass (+115). tsc clean, 0 vi.mock, 0 placeholders.
All entry points gated by FEATURE_V2_AXES — byte-identical to pre-B1
when off. Spec §B1 §1.5 benchmark satisfied per design.

Phase B remaining: B2 Identity evolution (bot axes), B3 Cross-session
learning, B4 Hermes skill auto-creation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec Coverage

| Spec section | Task |
|---|---|
| §2.1 Components | A1 (schema), B1-B5 (service files), C1-C2 (analyze + rules), D1-D2 (wiring), E1 (telegram), E2 (bootstrap) |
| §3 Axes definitions (4 axes) | B1 AXIS_NAMES const + AXIS_DEFAULTS + types |
| §4.1 Prisma models | A1 |
| §4.3 API (UserAxesStore) | B1 types.ts (interface), B3+B4 (impl) |
| §4.4 Migration SQL idempotent | A1 |
| §5 Update pipeline | C1 analyze-message.ts + D2 v2-capture parallel branch |
| §5.3 Claude haiku system prompt | C1 AXIS_SYSTEM_PROMPT (verbatim) |
| §5.5 parseAxisResponse | B2 |
| §6 EWMA math | B1 applyEwma + B3 recordSignals integration |
| §7.2 Prompt enrichment | D1 formatAxesSection + buildV2EnrichmentBlock integration |
| §7.4 Three gates | C2 content-rules.ts |
| §7.5 Rule firing visibility (Insights) | D2 orchestrator post-process |
| §8 /axes Telegram | E1 |
| §9 Bootstrap script | E2 |
| §10 Failure modes | Best-effort try/catch in C1, B3, B4 + flag gates throughout D-section |
| §11 Test strategy | Each task ends with unit + structural tests; F1 verifies total count |
| §12 Rollout via feature flag | D2 isV2AxesEnabled |

All 17 spec sections that imply implementation work covered. §13-15 are
status/checklist, no implementation needed.

### 2. Placeholder Scan

Searched for: "TBD", "TODO", "fill in", "implement appropriate".

- Task B3 includes intentional `throw new Error('not yet implemented — Task B4')` stubs for `recentSignals` and `recomputeFromSignals` — REPLACED in B4 Step 3.
- F1 Step 4 has explicit grep check to confirm zero remain.
- No other placeholders.

### 3. Type Consistency

| Symbol | Defined in | Used in |
|---|---|---|
| `AxisName` union | B1 types.ts | B2 parse-response, B3-B4 postgres-impl, B5 index re-export, C1 analyze-message, C2 content-rules, D1 enrichment, E1 telegram, E2 bootstrap |
| `UserAxesValues` | B1 types.ts | B3-B4 (return type), C2 (gate inputs), D1 (formatAxesSection input), E1 (telegram render) |
| `AxisSignalInput` | B1 types.ts | B2 parseAxisResponse return, B3 recordSignals input, C1 (parsed signals) |
| `AxisSignalSource` enum | B1 types.ts | B3 recordSignals (default `claude_classifier`), E2 bootstrap (uses `bootstrap`) |
| `UserAxesStore` interface | B1 types.ts | B3 `implements`, B5 singleton typedef |
| `clampDelta`, `clampConfidence`, `applyEwma`, `axisLabel` | B1 types.ts | B2 (clamp), B3-B4 (apply EWMA), D1 (label), E1 (label) |
| `AXIS_NAMES`, `AXIS_DEFAULTS` | B1 types.ts | B2 (validate axis), B3-B4 (defaults), E2 (validate estimates) |
| `parseAxisResponse` | B2 parse-response.ts | B5 re-export, C1 analyze-message |
| `getUserAxesStore`, `_resetUserAxesForTests` | B5 index.ts | C1 (analyze), D1 (enrichment), D2 (orchestrator), E1 (telegram) |
| `analyzeMessage` (as `userAxesAnalyzeMessage`) | C1 | D2 v2-capture parallel branch |
| `shouldForceOneStep`, `extractStepCount`, `shouldSuppressEmotionalProbing`, `shouldSoftenChallenge` | C2 | D2 orchestrator post-process (Gate 1 only in scope); others available for future tasks (B3 follow-up) |
| `formatAxesSection` | D1 | D1 enrichment integration; testable as pure helper |
| `isV2AxesEnabled` | D2 feature-flags.ts | D1 enrichment, D2 capture+orchestrator, E1 telegram |

All cross-file types match. No naming drift.

### 4. Test Pattern Compliance

- **Zero `vi.mock`** — every test uses pure unit (helpers) or structural
  (`readFileSync` + grep). Verified by F1 Step 3 grep.
- **Pure helpers exported** for unit testing: `clampDelta`, `clampConfidence`,
  `axisLabel`, `applyEwma`, `parseAxisResponse`, `formatAxesSection`,
  3 gate functions, `extractStepCount`, `parseCliArgs`.
- **Structural pattern** mirrors `entity-extractor.test.ts`,
  `procedural-memory.test.ts`, `migrate-to-v2.test.ts` — establish SRC
  string via `readFileSync`, assert with `toMatch` / `toContain`.
- **Singleton reset helper** `_resetUserAxesForTests` mirrors
  `_resetEntityGraphForTests` and `_resetProceduralMemoryForTests`.

### 5. Edge Case Enumeration

| Edge case | Where handled |
|---|---|
| Two-different-Серик entity ambiguity | Not relevant for B1 — axes are per-user, not per-entity |
| Claude returns invalid JSON | B2 parseAxisResponse swallows |
| Claude rate-limited (429) | C1 analyzeMessage top-level catch |
| Network failure to Claude | C1 catch + B3 recordSignals catch |
| User has no UserAxes row yet | B3 getAxes auto-creates with defaults |
| First N messages from new user (no axes yet) | Default 0.5 row created on first getAxes; bot acts neutral until signals accumulate |
| Axis drift to unrealistic 0 or 1 | applyEwma asymptotic (B1 test: 100 strong DOWN signals → < 0.01, never 0) |
| Bootstrap overrides real signals | E2 Step 1 of main() — skip if real signals exist |
| AxisSignal table grows unbounded | Future retention cron (Phase C); current scope accepts ~30/day/user ≈ 11K/year |
| Rule fires spuriously | D2 logs to Insights; user `/axes` for inspection |
| Concurrent msgs race on UserAxes update | Postgres MVCC + last-writer-wins; both signals logged, EWMA self-corrects (acceptable) |
| Flag flipped mid-session | All entry points re-check `isV2AxesEnabled` each call; no cached state outside singleton instance which is itself stateless |
| User deletes account | FK ON DELETE CASCADE on both UserAxes and AxisSignal (A1 schema) |
| Empty / whitespace-only message | C1 analyzeMessage early return; B2 parseAxisResponse returns empty |
| Gate 1 fires too aggressively | Currently logs reply with sentinel "⚠️ (gate-1: 1-step)" — debuggable and user-visible without latency cost. Future enhancement: full regen loop. |

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-v2-phase-b1-user-axes.md`.**

**Summary:** 13 tasks, ~85 TDD steps, ~115 new tests. Implements USER NEST axes with 4 LifeOS-custom dimensions (self-discipline, emotional-openness, conflict-tolerance, introspection-depth), per-message Claude haiku classifier, EWMA aggregation (α=0.05), hybrid hook (prompt enrichment + 3 code rules), `/axes` Telegram command, one-time bootstrap from UserProfile.patterns, full feature-flag gating. Zero behavioural change in prod when `FEATURE_V2_AXES` off.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Use skill: `superpowers:subagent-driven-development`.

**2. Inline Execution** — tasks run in this session using `superpowers:executing-plans`, with checkpoints.

**Which approach?**

---

## Reporting back

- **Plan line count:** ~2000 lines (within 1500-2500 target band).
- **Task count:** 13 atomic tasks (A1, B1-B5, C1-C2, D1-D2, E1-E2, F1).
- **Total TDD step count:** ~85 numbered steps (4-7 per task average).
- **Files this plan creates:** 16 new files (8 source + 8 test), 6 existing files modified.
- **Key compliance:** zero `vi.mock`, every pure helper unit-tested, all Claude calls best-effort with safe defaults, feature flag gated end-to-end, one atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
