# v2.0 Phase B2: Identity Evolution (BOT axes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement BOT Identity Evolution — an emergent persona (4 traits: warmth, directness, humor, playfulness + relationshipDepth scalar) that adapts TONE to the user's B1 axes and deepens over time, with a self-aware growth narrative the bot can articulate.

**Architecture:** New service `services/bot-traits/` with pure-compute trait formulas (no Claude in hot path) + Prisma persistence into existing `BotIdentity.traits` JSON. New `BotTraitSnapshot` table holds weekly snapshots powering a Claude-haiku growth narrative. Tone section injected into the v2 enrichment block. A proactivity detector emits a rare (max 1/month, KAIROS-gated) self-aware growth comment. `/identity` Telegram command + weekly snapshot cron + one-time bootstrap. Everything gated by `FEATURE_V2_IDENTITY`, byte-identical when off. Reuses B1's `getUserAxesStore()` for the userEO/userCT inputs.

**Tech Stack:** TypeScript ES2022 strict, Prisma 6.19 + Postgres, Anthropic Claude haiku (narrative only), Vitest 3.x. Mirror B1 patterns: pure helpers + structural tests via `readFileSync`+grep, dynamic-import for script tests, zero `vi.mock`, one atomic commit per task with `Co-Authored-By` trailer.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md` (approved by Berik 2026-05-31).

---

## File Structure

### New files (7 source + 7 test ≈ 14)

| Path | Est lines | Purpose |
|------|-----------|---------|
| `prisma/migrations/20260531190000_v2_bot_traits/migration.sql` | ~35 | Idempotent `BotTraitSnapshot` table |
| `src/services/bot-traits/types.ts` | ~140 | Interface + BotTraitName + pure helpers (logNorm, computeRelationshipDepth, computeBotTraits, traitLabel, DEFAULT_TRAITS, parseTraitsJson) |
| `src/services/bot-traits/types.test.ts` | ~150 | Unit tests for pure helpers |
| `src/services/bot-traits/postgres-impl.ts` | ~250 | `PostgresBotTraits` — getTraits, refreshTraits, refreshTraitsIfStale, snapshot, snapshotHistory |
| `src/services/bot-traits/postgres-impl.test.ts` | ~140 | Structural tests |
| `src/services/bot-traits/index.ts` | ~25 | Singleton accessor + `_resetBotTraitsForTests` |
| `src/services/bot-traits/index.test.ts` | ~45 | Singleton structural + identity/reset |
| `src/services/bot-traits/tone-section.ts` | ~110 | `formatToneSection` pure helper + 4 guidance helpers |
| `src/services/bot-traits/tone-section.test.ts` | ~90 | Unit tests |
| `src/services/bot-traits/growth-narrative.ts` | ~150 | `generateGrowthNarrative` Claude haiku + fallback |
| `src/services/bot-traits/growth-narrative.test.ts` | ~70 | Structural tests |
| `scripts/bootstrap-traits.ts` | ~160 | CLI: `--user --dry-run\|--apply`, compute initial traits + first snapshot |
| `src/scripts/bootstrap-traits.test.ts` | ~100 | parseCliArgs unit + structural (dynamic import) |
| `src/__integration__/v2-identity-flow.test.ts` | ~80 | Structural integration: orchestrator → tone, scheduler → snapshot cron |

### Modified files (7)

| Path | Lines added | Purpose |
|------|-------------|---------|
| `prisma/schema.prisma` | +20 | `BotTraitSnapshot` model + reverse relation on User |
| `src/lib/feature-flags.ts` | +20 | `isV2IdentityEnabled` |
| `src/lib/feature-flags.test.ts` | +25 | Tests for new flag |
| `src/services/v2-enrichment.ts` | +30 | Integrate tone section under flag |
| `src/services/v2-enrichment.test.ts` | +20 | Structural + sentinel for tone wiring |
| `src/services/jarvis-orchestrator.ts` | +20 | `refreshTraitsIfStale` hook before prompt build |
| `src/services/proactive-scheduler.ts` | +30 | Weekly `bot-traits-snapshot` cron via withCronLock |
| `src/services/v2-proactivity-engine.ts` | +70 | `detectIdentityGrowth` detector + nudge generation |
| `src/services/telegram-bot.ts` | +55 | `/identity` command |
| `docs/plan/v2-memory-proactivity-scope.md` | +1 row | Progress tracker |

---

## Task Table

| # | Section | Task | New files | Modified | Test Δ |
|---|---------|------|-----------|----------|--------|
| A1 | A — Schema | BotTraitSnapshot model + migration + local apply | migration.sql | schema.prisma | structural |
| B1 | B — Types | types.ts + 5 pure helpers + unit tests | types.ts, types.test.ts | — | +20 |
| B2 | B — Postgres I | PostgresBotTraits getTraits + refreshTraits | postgres-impl.ts, postgres-impl.test.ts | — | +8 |
| B3 | B — Postgres II | refreshTraitsIfStale + snapshot + snapshotHistory | postgres-impl.ts (extend) | — | +7 |
| B4 | B — Singleton | index.ts singleton + reset | index.ts, index.test.ts | — | +5 |
| C1 | C — Tone | tone-section.ts formatToneSection + guidance | tone-section.ts, tone-section.test.ts | — | +12 |
| C2 | C — Narrative | growth-narrative.ts Claude haiku + fallback | growth-narrative.ts, growth-narrative.test.ts | — | +8 |
| D1 | D — Wiring | flag + enrichment tone + orchestrator refresh hook | — | feature-flags.ts(+test), v2-enrichment.ts(+test), jarvis-orchestrator.ts | +11 |
| D2 | D — Proactivity | detectIdentityGrowth detector + nudge | — | v2-proactivity-engine.ts | +8 |
| E1 | E — Telegram | /identity command | — | telegram-bot.ts (+ new test file) | +5 |
| E2 | E — Cron | weekly bot-traits-snapshot cron | — | proactive-scheduler.ts (+ new test file) | +6 |
| E3 | E — Bootstrap | bootstrap-traits.ts script | bootstrap-traits.ts, bootstrap-traits.test.ts | — | +10 |
| F1 | F — Verify | integration test + full verify + progress commit | v2-identity-flow.test.ts | scope tracker | +6 |

**Total: 13 atomic tasks. ~106 new tests target (1529 → ~1635). Estimate 4-5 days at B1 pace.**

---

## Hard Constraints

- **Zero `vi.mock`** — pure unit for helpers; structural (`readFileSync`+grep) for class/wiring. Verify `grep -r "vi\.mock" packages/server/src/` returns 0.
- **Best-effort everywhere** — `refreshTraits`, `generateGrowthNarrative`, detector, cron all wrapped in top-level try/catch; never throw to caller.
- **Feature flag gated** — every new production entry point checks `isV2IdentityEnabled(userId)`. Off → byte-identical to pre-B2.
- **No Claude in hot path** — traits computed via pure formula; Claude only for `/identity` narrative + proactive growth comment.
- **One atomic commit per task** + trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **TDD** — failing test FIRST. RED → GREEN explicit.
- **Pure helpers exported** for unit testing: `logNorm`, `computeRelationshipDepth`, `computeBotTraits`, `traitLabel`, `parseTraitsJson`, `formatToneSection`, `parseCliArgs`.
- **`.js` extension** in all imports (bundler module resolution).
- **Script tests use dynamic-import pattern** (per migrate-to-v2 / bootstrap-axes) to bypass tsc rootDir.
- **Conventional commits:** `feat(v2-identity):` / `feat(v2-identity-wiring):` / `feat(v2-identity-telegram):` / `feat(v2-identity-cron):` / `feat(v2-identity-migration):` / `docs(v2-progress):`.

---

## Section A — Schema + Migration (1 task)

### Task A1: `BotTraitSnapshot` model + idempotent migration

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/20260531190000_v2_bot_traits/migration.sql`

- [ ] **Step 1: Add Prisma model to schema**

Edit `packages/server/prisma/schema.prisma`. Add after the `BotIdentity` model:

```prisma
// ───────────────────────────────────────────────────────────────────────────
// v2 Phase B2 — Identity Evolution: weekly snapshots of BOT traits.
// Spec: docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md
// BotIdentity.traits (existing Json) holds CURRENT traits; these snapshots
// power the growth narrative (compare oldest vs current).
// ───────────────────────────────────────────────────────────────────────────

model BotTraitSnapshot {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  warmth        Float
  directness    Float
  humor         Float
  playfulness   Float
  depth         Float
  recordedAt    DateTime @default(now())

  @@index([userId, recordedAt])
}
```

Add the reverse relation to the `User` model (inside its block, after the existing v2 relations like `userAxes`/`axisSignals`):

```prisma
  botTraitSnapshots BotTraitSnapshot[]
```

- [ ] **Step 2: Format schema**

```bash
cd packages/server
npx prisma format
```

Expected: reformatted, no errors.

- [ ] **Step 3: Create migration file (idempotent)**

Create directory `packages/server/prisma/migrations/20260531190000_v2_bot_traits/` then `migration.sql`:

```sql
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
```

- [ ] **Step 4: Apply migration locally via Docker**

```bash
cd packages/server
docker compose -f docker-compose.dev.yml ps   # confirm postgres up
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx prisma db execute --schema=prisma/schema.prisma \
  --file prisma/migrations/20260531190000_v2_bot_traits/migration.sql
```

Expected: `Script executed successfully.`

- [ ] **Step 5: Verify table + index**

```bash
docker exec server-postgres-1 psql -U postgres -d lifeos_dev \
  -c "\d \"BotTraitSnapshot\""
```

Expected: 7 columns, FK constraint, 1 index on (userId, recordedAt).

- [ ] **Step 6: Re-apply to verify idempotency**

```bash
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx prisma db execute --schema=prisma/schema.prisma \
  --file prisma/migrations/20260531190000_v2_bot_traits/migration.sql
```

Expected: `Script executed successfully.` (no errors).

- [ ] **Step 7: Generate Prisma client**

```bash
cd packages/server
npx prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [ ] **Step 8: tsc + full suite**

```bash
cd packages/server
npx tsc --noEmit
npm test
```

Expected: tsc clean, all tests green (baseline 1529+).

- [ ] **Step 9: Commit**

```bash
git add packages/server/prisma/schema.prisma \
        packages/server/prisma/migrations/20260531190000_v2_bot_traits/
git commit -m "$(cat <<'EOF'
feat(v2-identity): BotTraitSnapshot model + idempotent migration (A1)

First step of Phase B2 Identity Evolution. New BotTraitSnapshot table
holds weekly snapshots of the 4 bot traits + relationshipDepth, powering
the growth narrative (compare oldest vs current). Current traits live in
the existing BotIdentity.traits JSON — no change to that model.

Idempotent SQL (CREATE TABLE IF NOT EXISTS + DO $$ FK guard) mirrors
Week 2/6/B1 patterns. Applied locally via Docker; re-application verified
no-op. Prisma client regenerated. tsc clean, suite green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section B — Types, Persistence, Singleton (4 tasks)

### Task B1: `types.ts` — interface + 5 pure helpers + unit tests

**Files:**
- Create: `packages/server/src/services/bot-traits/types.ts`
- Create: `packages/server/src/services/bot-traits/types.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/bot-traits/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  logNorm,
  computeRelationshipDepth,
  computeBotTraits,
  traitLabel,
  parseTraitsJson,
  DEFAULT_TRAITS,
  BOT_TRAIT_NAMES,
} from './types.js';

describe('logNorm', () => {
  it('zero or negative → 0', () => {
    expect(logNorm(0, 100)).toBe(0);
    expect(logNorm(-5, 100)).toBe(0);
  });
  it('at cap → ~1', () => {
    expect(logNorm(100, 100)).toBeCloseTo(1, 5);
  });
  it('monotonic increasing', () => {
    expect(logNorm(10, 100)).toBeLessThan(logNorm(50, 100));
  });
  it('bounded to [0, 1]', () => {
    expect(logNorm(1000, 100)).toBe(1);
  });
});

describe('computeRelationshipDepth', () => {
  it('all-zero stats → 0', () => {
    expect(computeRelationshipDepth({
      messageCount: 0, daysSinceFirst: 0, distinctEntities: 0, emotionalMoments: 0,
    })).toBe(0);
  });
  it('maxed stats → close to 1', () => {
    const d = computeRelationshipDepth({
      messageCount: 500, daysSinceFirst: 365, distinctEntities: 100, emotionalMoments: 50,
    });
    expect(d).toBeGreaterThan(0.9);
  });
  it('monotonic in messageCount', () => {
    const base = { daysSinceFirst: 30, distinctEntities: 10, emotionalMoments: 5 };
    expect(computeRelationshipDepth({ ...base, messageCount: 10 }))
      .toBeLessThan(computeRelationshipDepth({ ...base, messageCount: 200 }));
  });
  it('bounded to [0, 1]', () => {
    const d = computeRelationshipDepth({
      messageCount: 99999, daysSinceFirst: 99999, distinctEntities: 9999, emotionalMoments: 9999,
    });
    expect(d).toBeLessThanOrEqual(1);
    expect(d).toBeGreaterThanOrEqual(0);
  });
});

describe('computeBotTraits', () => {
  it('neutral axes + depth 0 baseline', () => {
    const t = computeBotTraits(0.5, 0.5, 0);
    expect(t.warmth).toBeCloseTo(0.60, 2);
    expect(t.directness).toBeCloseTo(0.525, 2);
    expect(t.humor).toBeCloseTo(0.275, 2);
    expect(t.playfulness).toBeCloseTo(0.40, 2);
  });
  it('monotonic in depth — bot warms over time', () => {
    const low = computeBotTraits(0.5, 0.5, 0.1);
    const high = computeBotTraits(0.5, 0.5, 0.9);
    expect(high.warmth).toBeGreaterThan(low.warmth);
    expect(high.directness).toBeGreaterThan(low.directness);
    expect(high.humor).toBeGreaterThan(low.humor);
    expect(high.playfulness).toBeGreaterThan(low.playfulness);
  });
  it('warmth responds to userEO', () => {
    const lowEO = computeBotTraits(0.1, 0.5, 0.3);
    const highEO = computeBotTraits(0.9, 0.5, 0.3);
    expect(highEO.warmth).toBeGreaterThan(lowEO.warmth);
  });
  it('directness responds to userCT', () => {
    const lowCT = computeBotTraits(0.5, 0.1, 0.3);
    const highCT = computeBotTraits(0.5, 0.9, 0.3);
    expect(highCT.directness).toBeGreaterThan(lowCT.directness);
  });
  it('all traits clamped to [0, 1]', () => {
    const t = computeBotTraits(1, 1, 1);
    Object.values(t).forEach((v) => {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('traitLabel', () => {
  it('buckets correctly', () => {
    expect(traitLabel(0.1)).toBe('очень низкий');
    expect(traitLabel(0.3)).toBe('низкий');
    expect(traitLabel(0.5)).toBe('средний');
    expect(traitLabel(0.75)).toBe('высокий');
    expect(traitLabel(0.95)).toBe('очень высокий');
  });
});

describe('parseTraitsJson', () => {
  it('valid traits object', () => {
    const json = {
      warmth: 0.6, directness: 0.5, humor: 0.3, playfulness: 0.4,
      relationshipDepth: 0.2, lastComputedAt: '2026-05-31T09:00:00Z',
    };
    const out = parseTraitsJson(json);
    expect(out.warmth).toBe(0.6);
    expect(out.relationshipDepth).toBe(0.2);
    expect(out.lastComputedAt).toBeInstanceOf(Date);
  });
  it('empty object → DEFAULT_TRAITS', () => {
    const out = parseTraitsJson({});
    expect(out.warmth).toBe(DEFAULT_TRAITS.warmth);
    expect(out.lastComputedAt).toBeNull();
  });
  it('null → DEFAULT_TRAITS', () => {
    expect(parseTraitsJson(null).warmth).toBe(DEFAULT_TRAITS.warmth);
  });
  it('partial object fills missing with defaults', () => {
    const out = parseTraitsJson({ warmth: 0.9 });
    expect(out.warmth).toBe(0.9);
    expect(out.directness).toBe(DEFAULT_TRAITS.directness);
  });
  it('malformed lastComputedAt → null', () => {
    const out = parseTraitsJson({ warmth: 0.5, lastComputedAt: 'garbage' });
    expect(out.lastComputedAt).toBeNull();
  });
});

describe('BOT_TRAIT_NAMES', () => {
  it('has exactly 4 entries', () => {
    expect(BOT_TRAIT_NAMES).toEqual(['warmth', 'directness', 'humor', 'playfulness']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/types.test.ts
```

Expected: FAIL — `Cannot find module './types.js'`.

- [ ] **Step 3: Implement `types.ts`**

Create `packages/server/src/services/bot-traits/types.ts`:

```typescript
/**
 * v2.0 Phase B2 — Identity Evolution types and pure helpers.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md
 *
 * Pure helpers (logNorm, computeRelationshipDepth, computeBotTraits,
 * traitLabel, parseTraitsJson) exported for unit testing without DB/Claude.
 *
 * Trait values are continuous Float [0, 1]. Bot traits = f(user B1 axes,
 * relationshipDepth). Depth grows slowly with relationship tenure +
 * richness, so the bot's persona deepens (warmer, more direct, more
 * playful) over months.
 */

export type BotTraitName = 'warmth' | 'directness' | 'humor' | 'playfulness';

export const BOT_TRAIT_NAMES: readonly BotTraitName[] = [
  'warmth', 'directness', 'humor', 'playfulness',
] as const;

export interface BotTraits {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  relationshipDepth: number;
  lastComputedAt: Date | null;
}

export const DEFAULT_TRAITS: BotTraits = {
  warmth: 0.5,
  directness: 0.5,
  humor: 0.3,
  playfulness: 0.4,
  relationshipDepth: 0,
  lastComputedAt: null,
};

export interface RelationshipStats {
  messageCount: number;
  daysSinceFirst: number;
  distinctEntities: number;
  emotionalMoments: number;
}

export interface TraitSnapshot {
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  depth: number;
  recordedAt: Date;
}

export interface BotTraitsStore {
  getTraits(userId: string): Promise<BotTraits>;
  refreshTraits(userId: string): Promise<BotTraits>;
  refreshTraitsIfStale(userId: string, staleMs?: number): Promise<BotTraits>;
  snapshot(userId: string): Promise<void>;
  snapshotHistory(userId: string, limit?: number): Promise<TraitSnapshot[]>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Logarithmic normalization — maps [0, ∞) to [0, 1) with diminishing
 * returns. Output ≈ 1 when value reaches `cap`. value ≤ 0 → 0.
 */
export function logNorm(value: number, cap: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(cap));
}

/**
 * relationshipDepth [0, 1] from interaction stats. Weighted:
 *   30% messages, 30% tenure, 20% entities, 20% emotional moments.
 * Caps: 500 msgs / 365 days / 100 entities / 50 emotional moments → deep.
 */
export function computeRelationshipDepth(stats: RelationshipStats): number {
  const msg = logNorm(stats.messageCount, 500);
  const days = logNorm(stats.daysSinceFirst, 365);
  const ent = logNorm(stats.distinctEntities, 100);
  const emo = logNorm(stats.emotionalMoments, 50);
  const weighted = 0.30 * msg + 0.30 * days + 0.20 * ent + 0.20 * emo;
  return Math.max(0, Math.min(1, weighted));
}

/**
 * Compute the 4 bot traits from user B1 axes + relationship depth.
 *
 *   warmth      = 0.45 + 0.30·userEO + 0.25·depth
 *   directness  = 0.30 + 0.45·userCT + 0.25·depth
 *   humor       = 0.20 + 0.50·depth  + 0.15·userEO
 *   playfulness = 0.30 + 0.30·depth  + 0.20·userEO
 *
 * Monotonic in depth (bot warms over time), responsive to user axes
 * (different bots for different users), all clamped [0, 1].
 */
export function computeBotTraits(
  userEO: number,
  userCT: number,
  depth: number,
): { warmth: number; directness: number; humor: number; playfulness: number } {
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return {
    warmth:      c(0.45 + 0.30 * userEO + 0.25 * depth),
    directness:  c(0.30 + 0.45 * userCT + 0.25 * depth),
    humor:       c(0.20 + 0.50 * depth + 0.15 * userEO),
    playfulness: c(0.30 + 0.30 * depth + 0.20 * userEO),
  };
}

/** Russian semantic label for a trait value (mirrors B1 axisLabel). */
export function traitLabel(value: number): string {
  if (value < 0.2) return 'очень низкий';
  if (value < 0.4) return 'низкий';
  if (value <= 0.6) return 'средний';
  if (value <= 0.8) return 'высокий';
  return 'очень высокий';
}

/**
 * Parse the BotIdentity.traits JSON blob into a typed BotTraits.
 * Missing fields fall back to DEFAULT_TRAITS. Malformed lastComputedAt
 * → null. Never throws.
 */
export function parseTraitsJson(raw: unknown): BotTraits {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TRAITS };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def;

  let lastComputedAt: Date | null = null;
  if (typeof o.lastComputedAt === 'string') {
    const d = new Date(o.lastComputedAt);
    if (!Number.isNaN(d.getTime())) lastComputedAt = d;
  }

  return {
    warmth: num(o.warmth, DEFAULT_TRAITS.warmth),
    directness: num(o.directness, DEFAULT_TRAITS.directness),
    humor: num(o.humor, DEFAULT_TRAITS.humor),
    playfulness: num(o.playfulness, DEFAULT_TRAITS.playfulness),
    relationshipDepth: num(o.relationshipDepth, DEFAULT_TRAITS.relationshipDepth),
    lastComputedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/types.test.ts
```

Expected: all tests pass (20+).

- [ ] **Step 5: tsc**

```bash
cd packages/server
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-traits/types.ts \
        packages/server/src/services/bot-traits/types.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): types + 5 pure helpers (logNorm, depth, traits, label, parse) (B1)

Defines BotTraitName, BotTraits, RelationshipStats, TraitSnapshot,
BotTraitsStore interface, DEFAULT_TRAITS const.

Pure helpers (unit-tested, no DB/Claude):
- logNorm — log-scale normalization with cap
- computeRelationshipDepth — weighted (msg/tenure/entities/emotion),
  caps 500/365/100/50, bounded [0,1]
- computeBotTraits — 4 traits = f(userEO, userCT, depth); monotonic in
  depth (bot warms over time), responsive to user axes
- traitLabel — Russian semantic buckets (mirror B1 axisLabel)
- parseTraitsJson — defensive parse of BotIdentity.traits blob, fills
  missing with defaults, never throws

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `PostgresBotTraits` skeleton + `getTraits` + `refreshTraits`

**Files:**
- Create: `packages/server/src/services/bot-traits/postgres-impl.ts`
- Create: `packages/server/src/services/bot-traits/postgres-impl.test.ts`

**Goal:** Concrete store. `getTraits` reads `BotIdentity.traits`. `refreshTraits` gathers stats + B1 axes, computes, persists. `refreshTraitsIfStale`/`snapshot`/`snapshotHistory` are placeholders for B3.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/bot-traits/postgres-impl.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresBotTraits } from './postgres-impl.js';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/postgres-impl.ts'),
  'utf-8',
);

describe('PostgresBotTraits — class shape', () => {
  it('class exported + implements all methods', () => {
    const inst = new PostgresBotTraits();
    expect(typeof inst.getTraits).toBe('function');
    expect(typeof inst.refreshTraits).toBe('function');
    expect(typeof inst.refreshTraitsIfStale).toBe('function');
    expect(typeof inst.snapshot).toBe('function');
    expect(typeof inst.snapshotHistory).toBe('function');
  });
});

describe('postgres-impl.ts structural — getTraits', () => {
  it('reads BotIdentity via Prisma + parseTraitsJson', () => {
    const start = SRC.indexOf('async getTraits');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botIdentity.findUnique');
    expect(body).toContain('parseTraitsJson');
  });
  it('falls back to DEFAULT_TRAITS when identity missing', () => {
    const start = SRC.indexOf('async getTraits');
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('DEFAULT_TRAITS');
  });
});

describe('postgres-impl.ts structural — refreshTraits', () => {
  it('gathers stats: ChatMessage count, first msg, Entity count, MoodSnapshot', () => {
    const start = SRC.indexOf('async refreshTraits');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('chatMessage.count');
    expect(body).toContain('entity.count');
    expect(body).toContain('moodSnapshot');
  });
  it('reads B1 user axes via getUserAxesStore', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3000);
    expect(body).toMatch(/getUserAxesStore\(\)\.getAxes/);
  });
  it('uses computeRelationshipDepth + computeBotTraits', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3000);
    expect(body).toContain('computeRelationshipDepth');
    expect(body).toContain('computeBotTraits');
  });
  it('persists to BotIdentity.traits via update/upsert', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3500);
    expect(body).toMatch(/prisma\.botIdentity\.(update|upsert)/);
    expect(body).toContain('lastComputedAt');
  });
  it('best-effort try/catch — never throws', () => {
    const start = SRC.indexOf('async refreshTraits');
    const body = SRC.slice(start, start + 3500);
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/postgres-impl.test.ts
```

Expected: FAIL — class not exported.

- [ ] **Step 3: Implement `postgres-impl.ts`**

Create `packages/server/src/services/bot-traits/postgres-impl.ts`:

```typescript
/**
 * v2.0 Phase B2 — PostgresBotTraits — concrete BotTraitsStore.
 *
 * Spec §4-5. Traits computed via pure formula from B1 user axes +
 * relationship stats, persisted into the existing BotIdentity.traits JSON.
 * Best-effort throughout — never throws to callers.
 */

import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import {
  DEFAULT_TRAITS,
  computeBotTraits,
  computeRelationshipDepth,
  parseTraitsJson,
  type BotTraits,
  type BotTraitsStore,
  type RelationshipStats,
  type TraitSnapshot,
} from './types.js';
import type { Prisma } from '@prisma/client';

export class PostgresBotTraits implements BotTraitsStore {
  async getTraits(userId: string): Promise<BotTraits> {
    try {
      const identity = await prisma.botIdentity.findUnique({
        where: { userId },
        select: { traits: true },
      });
      if (!identity) return { ...DEFAULT_TRAITS };
      return parseTraitsJson(identity.traits);
    } catch (err) {
      console.warn('[bot-traits:getTraits] failed:', err);
      return { ...DEFAULT_TRAITS };
    }
  }

  async refreshTraits(userId: string): Promise<BotTraits> {
    try {
      // 1. Gather relationship stats.
      const [messageCount, firstMsg, distinctEntities, emotionalMoments] =
        await Promise.all([
          prisma.chatMessage.count({ where: { userId } }),
          prisma.chatMessage.findFirst({
            where: { userId },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
          prisma.entity.count({ where: { userId } }),
          prisma.moodSnapshot.count({
            where: { userId, OR: [{ valence: { gt: 0.4 } }, { valence: { lt: -0.4 } }] },
          }),
        ]);

      const daysSinceFirst = firstMsg
        ? Math.max(0, (Date.now() - firstMsg.createdAt.getTime()) / 86400_000)
        : 0;

      const stats: RelationshipStats = {
        messageCount,
        daysSinceFirst,
        distinctEntities,
        emotionalMoments,
      };
      const depth = computeRelationshipDepth(stats);

      // 2. Read B1 user axes (graceful: defaults 0.5 if B1 off).
      const axes = await getUserAxesStore().getAxes(userId);
      const traits = computeBotTraits(
        axes.emotionalOpenness,
        axes.conflictTolerance,
        depth,
      );

      const now = new Date();
      const blob = {
        warmth: traits.warmth,
        directness: traits.directness,
        humor: traits.humor,
        playfulness: traits.playfulness,
        relationshipDepth: depth,
        lastComputedAt: now.toISOString(),
      };

      // 3. Persist into BotIdentity.traits (upsert — identity may not exist).
      await prisma.botIdentity.upsert({
        where: { userId },
        create: { userId, traits: blob as Prisma.InputJsonValue },
        update: { traits: blob as Prisma.InputJsonValue },
      });

      return {
        warmth: traits.warmth,
        directness: traits.directness,
        humor: traits.humor,
        playfulness: traits.playfulness,
        relationshipDepth: depth,
        lastComputedAt: now,
      };
    } catch (err) {
      console.warn('[bot-traits:refreshTraits] failed:', err);
      return this.getTraits(userId);
    }
  }

  async refreshTraitsIfStale(_userId: string, _staleMs?: number): Promise<BotTraits> {
    throw new Error('refreshTraitsIfStale not yet implemented — Task B3');
  }

  async snapshot(_userId: string): Promise<void> {
    throw new Error('snapshot not yet implemented — Task B3');
  }

  async snapshotHistory(_userId: string, _limit?: number): Promise<TraitSnapshot[]> {
    throw new Error('snapshotHistory not yet implemented — Task B3');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/postgres-impl.test.ts
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
git add packages/server/src/services/bot-traits/postgres-impl.ts \
        packages/server/src/services/bot-traits/postgres-impl.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): PostgresBotTraits skeleton + getTraits + refreshTraits (B2)

Concrete BotTraitsStore. getTraits reads BotIdentity.traits + parses
(defaults if identity missing). refreshTraits gathers relationship stats
(ChatMessage count, first-msg date, Entity count, MoodSnapshot
|valence|>0.4 count), reads B1 user axes via getUserAxesStore (graceful
0.5 defaults if B1 off), computes depth + traits via pure formulas,
persists into BotIdentity.traits JSON via upsert.

refreshTraitsIfStale / snapshot / snapshotHistory are placeholders for B3.

Best-effort try/catch — never throws.

+8 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `refreshTraitsIfStale` + `snapshot` + `snapshotHistory`

**Files:**
- Modify: `packages/server/src/services/bot-traits/postgres-impl.ts`
- Modify: `packages/server/src/services/bot-traits/postgres-impl.test.ts`

- [ ] **Step 1: Append failing structural tests**

Append to `packages/server/src/services/bot-traits/postgres-impl.test.ts`:

```typescript
describe('postgres-impl.ts structural — refreshTraitsIfStale', () => {
  it('reads current traits then compares lastComputedAt against staleMs', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('lastComputedAt');
    expect(body).toMatch(/staleMs/);
  });
  it('default stale window 6h', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    const body = SRC.slice(start, start + 1200);
    expect(body).toMatch(/6\s*\*\s*60\s*\*\s*60\s*\*\s*1000|21_?600_?000/);
  });
  it('calls refreshTraits when stale', () => {
    const start = SRC.indexOf('async refreshTraitsIfStale');
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/this\.refreshTraits\(/);
  });
});

describe('postgres-impl.ts structural — snapshot', () => {
  it('writes BotTraitSnapshot row with current traits', () => {
    const start = SRC.indexOf('async snapshot');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botTraitSnapshot.create');
    expect(body).toContain('warmth');
    expect(body).toContain('depth');
  });
});

describe('postgres-impl.ts structural — snapshotHistory', () => {
  it('queries BotTraitSnapshot ordered by recordedAt ASC (oldest first)', () => {
    const start = SRC.indexOf('async snapshotHistory');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botTraitSnapshot.findMany');
    expect(body).toMatch(/orderBy.*recordedAt.*asc/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/postgres-impl.test.ts
```

Expected: new tests FAIL (placeholders throw).

- [ ] **Step 3: Replace placeholders**

In `packages/server/src/services/bot-traits/postgres-impl.ts`, replace the three placeholder methods:

```typescript
  async refreshTraitsIfStale(
    userId: string,
    staleMs: number = 6 * 60 * 60 * 1000,
  ): Promise<BotTraits> {
    try {
      const current = await this.getTraits(userId);
      const fresh =
        current.lastComputedAt !== null &&
        Date.now() - current.lastComputedAt.getTime() < staleMs;
      if (fresh) return current;
      return this.refreshTraits(userId);
    } catch (err) {
      console.warn('[bot-traits:refreshTraitsIfStale] failed:', err);
      return this.getTraits(userId);
    }
  }

  async snapshot(userId: string): Promise<void> {
    try {
      const t = await this.getTraits(userId);
      await prisma.botTraitSnapshot.create({
        data: {
          userId,
          warmth: t.warmth,
          directness: t.directness,
          humor: t.humor,
          playfulness: t.playfulness,
          depth: t.relationshipDepth,
        },
      });
    } catch (err) {
      console.warn('[bot-traits:snapshot] failed:', err);
    }
  }

  async snapshotHistory(
    userId: string,
    limit: number = 50,
  ): Promise<TraitSnapshot[]> {
    try {
      const rows = await prisma.botTraitSnapshot.findMany({
        where: { userId },
        orderBy: { recordedAt: 'asc' },
        take: limit,
        select: {
          warmth: true, directness: true, humor: true,
          playfulness: true, depth: true, recordedAt: true,
        },
      });
      return rows;
    } catch (err) {
      console.warn('[bot-traits:snapshotHistory] failed:', err);
      return [];
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/postgres-impl.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-traits/postgres-impl.ts \
        packages/server/src/services/bot-traits/postgres-impl.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): refreshTraitsIfStale + snapshot + snapshotHistory (B3)

Completes PostgresBotTraits:
- refreshTraitsIfStale: recompute only if lastComputedAt older than
  staleMs (default 6h); else return cached. Cheap lazy refresh for the
  per-message orchestrator hook.
- snapshot: write a BotTraitSnapshot row with current traits + depth.
- snapshotHistory: BotTraitSnapshot rows oldest-first (default 50) —
  feeds the growth narrative (compare oldest vs current).

All best-effort try/catch.

+7 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Singleton accessor

**Files:**
- Create: `packages/server/src/services/bot-traits/index.ts`
- Create: `packages/server/src/services/bot-traits/index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/bot-traits/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/index.ts'),
  'utf-8',
);

describe('bot-traits/index.ts structural', () => {
  it('exports getBotTraitsStore', () => {
    expect(SRC).toMatch(/export function getBotTraitsStore/);
  });
  it('exports _resetBotTraitsForTests', () => {
    expect(SRC).toMatch(/export function _resetBotTraitsForTests/);
  });
  it('re-exports BotTraitsStore type + PostgresBotTraits', () => {
    expect(SRC).toContain('BotTraitsStore');
    expect(SRC).toContain('PostgresBotTraits');
  });
  it('singleton returns same instance', async () => {
    const { getBotTraitsStore, _resetBotTraitsForTests } = await import('./index.js');
    _resetBotTraitsForTests();
    const a = getBotTraitsStore();
    const b = getBotTraitsStore();
    expect(a).toBe(b);
  });
  it('_resetBotTraitsForTests creates fresh instance', async () => {
    const { getBotTraitsStore, _resetBotTraitsForTests } = await import('./index.js');
    _resetBotTraitsForTests();
    const a = getBotTraitsStore();
    _resetBotTraitsForTests();
    const b = getBotTraitsStore();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/index.test.ts
```

Expected: FAIL — `ENOENT`.

- [ ] **Step 3: Implement `index.ts`**

Create `packages/server/src/services/bot-traits/index.ts`:

```typescript
/**
 * v2.0 Phase B2 — BotTraitsStore public entry point.
 *
 * Lazy singleton + test reset. Mirrors user-axes/index.ts pattern.
 * Wired into orchestrator (D1), proactivity (D2), telegram (E1), cron (E2).
 */

export {
  BOT_TRAIT_NAMES,
  DEFAULT_TRAITS,
  type BotTraitName,
  type BotTraits,
  type BotTraitsStore,
  type RelationshipStats,
  type TraitSnapshot,
  logNorm,
  computeRelationshipDepth,
  computeBotTraits,
  traitLabel,
  parseTraitsJson,
} from './types.js';

export { PostgresBotTraits } from './postgres-impl.js';

import { PostgresBotTraits } from './postgres-impl.js';
import type { BotTraitsStore } from './types.js';

let _instance: BotTraitsStore | null = null;

/** Global lazy singleton of the bot-traits store. */
export function getBotTraitsStore(): BotTraitsStore {
  if (!_instance) {
    _instance = new PostgresBotTraits();
  }
  return _instance;
}

/** For tests only — clear singleton between test files. */
export function _resetBotTraitsForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/index.test.ts
```

Expected: all 5 pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-traits/index.ts \
        packages/server/src/services/bot-traits/index.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): bot-traits singleton accessor + public re-exports (B4)

Lazy singleton (PostgresBotTraits) + _resetBotTraitsForTests. Re-exports
types + pure helpers + PostgresBotTraits class. Mirrors user-axes/index.ts.

+5 tests (structural + singleton identity / reset).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section C — Tone + Narrative (2 tasks)

### Task C1: `tone-section.ts` — formatToneSection + guidance

**Files:**
- Create: `packages/server/src/services/bot-traits/tone-section.ts`
- Create: `packages/server/src/services/bot-traits/tone-section.test.ts`

**Goal:** Pure helper rendering the bot-persona block for the system prompt. This is the TONE layer B1 deferred.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/bot-traits/tone-section.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatToneSection } from './tone-section.js';
import type { BotTraits } from './types.js';

const base: BotTraits = {
  warmth: 0.5, directness: 0.5, humor: 0.3, playfulness: 0.4,
  relationshipDepth: 0.2, lastComputedAt: null,
};

describe('formatToneSection', () => {
  it('null traits → empty string', () => {
    expect(formatToneSection(null, 47)).toBe('');
  });
  it('renders all 4 traits with values + labels', () => {
    const out = formatToneSection(base, 47);
    expect(out).toContain('warmth: 0.50');
    expect(out).toContain('directness: 0.50');
    expect(out).toContain('humor: 0.30');
    expect(out).toContain('playfulness: 0.40');
  });
  it('shows relationship depth + message count', () => {
    const out = formatToneSection(base, 47);
    expect(out).toContain('0.20');
    expect(out).toContain('47');
  });
  it('high warmth includes warm guidance', () => {
    const out = formatToneSection({ ...base, warmth: 0.85 }, 100);
    expect(out).toContain('warmth: 0.85');
    expect(out.toLowerCase()).toMatch(/тёпл|забот/);
  });
  it('high directness includes direct guidance', () => {
    const out = formatToneSection({ ...base, directness: 0.85 }, 100);
    expect(out.toLowerCase()).toMatch(/прям|честн/);
  });
  it('low humor suppresses jokes', () => {
    const out = formatToneSection({ ...base, humor: 0.15 }, 100);
    expect(out.toLowerCase()).toMatch(/серьёзн|без шут|мало/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/tone-section.test.ts
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `tone-section.ts`**

Create `packages/server/src/services/bot-traits/tone-section.ts`:

```typescript
/**
 * v2.0 Phase B2 — render the bot-persona TONE block for the system prompt.
 *
 * Spec §6. Pure helper (no I/O). This is the TONE layer B1 deferred:
 * the bot's warmth/directness/humor/playfulness shape HOW it speaks,
 * adapting to the user's axes and deepening with relationship.
 */

import { traitLabel, type BotTraits } from './types.js';

export function formatToneSection(
  traits: BotTraits | null,
  messageCount: number,
): string {
  if (!traits) return '';

  const lines: string[] = [
    '## Твоя персона (как ты звучишь — continuous 0..1)',
    '',
  ];

  const w = traits.warmth;
  lines.push(`- warmth: ${w.toFixed(2)} (${traitLabel(w)}) — ${guidanceWarmth(w)}`);
  const d = traits.directness;
  lines.push(`- directness: ${d.toFixed(2)} (${traitLabel(d)}) — ${guidanceDirectness(d)}`);
  const h = traits.humor;
  lines.push(`- humor: ${h.toFixed(2)} (${traitLabel(h)}) — ${guidanceHumor(h)}`);
  const p = traits.playfulness;
  lines.push(`- playfulness: ${p.toFixed(2)} (${traitLabel(p)}) — ${guidancePlayfulness(p)}`);

  lines.push('');
  lines.push(
    `Глубина связи: ${traits.relationshipDepth.toFixed(2)} (${messageCount} сообщений). ` +
      `${depthGuidance(traits.relationshipDepth)}`,
  );

  return lines.join('\n');
}

function guidanceWarmth(v: number): string {
  if (v < 0.4) return 'Держись делового, нейтрального тона. Меньше эмоциональных слов.';
  if (v <= 0.6) return 'Тёплый, но не приторный. Поддержка к месту.';
  if (v <= 0.8) return 'Будь тёплой, показывай заботу. Не только дела — человек.';
  return 'Очень тёплая — эмоциональная поддержка, искренность, «я рядом».';
}

function guidanceDirectness(v: number): string {
  if (v < 0.4) return 'Обходительно, мягко обрамляй. «Может стоит» вместо «делай».';
  if (v <= 0.6) return 'Говори честно, но мягко обрамляй. Не руби с плеча.';
  if (v <= 0.8) return 'Прямо: «вот что не так». Юзер ценит честность.';
  return 'Очень прямая — без обиняков, правда в лицо, юзер этого хочет.';
}

function guidanceHumor(v: number): string {
  if (v < 0.4) return 'Серьёзный тон, лёгкие шутки лишь изредка. Без перебора.';
  if (v <= 0.6) return 'Шути к месту, лёгкая ирония уместна.';
  if (v <= 0.8) return 'Играй, шути, ссылайся на shared moments.';
  return 'Очень игривая — inside jokes, callbacks, лёгкость.';
}

function guidancePlayfulness(v: number): string {
  if (v < 0.4) return 'Спокойный, ровный тон. Без лишней экспрессии.';
  if (v <= 0.6) return 'Умеренная энергия. Не слишком ярко, не слишком сухо.';
  if (v <= 0.8) return 'Энергично, expressive, эмодзи к месту.';
  return 'Очень живая — яркая, экспрессивная, восклицания.';
}

function depthGuidance(v: number): string {
  if (v < 0.2) return 'Вы недавно знакомы — будь внимательной, не фамильярничай.';
  if (v < 0.5) return 'Можешь ссылаться на прошлые разговоры, но без излишней фамильярности.';
  return 'Вы давно вместе — можешь быть ближе, честнее, играивее.';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/tone-section.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-traits/tone-section.ts \
        packages/server/src/services/bot-traits/tone-section.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): formatToneSection — bot persona system-prompt block (C1)

Spec §6. Pure helper rendering the TONE block B1 deferred. Each of the 4
traits gets a value + label + bucketed behavioural guidance (4 levels):
warmth → how affectionate, directness → how blunt, humor → how playful,
playfulness → how expressive. Plus a relationship-depth line that adapts
familiarity to tenure.

Null traits → empty string (flag off / no identity yet).

+12 unit tests across all levels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `growth-narrative.ts` — Claude haiku growth story

**Files:**
- Create: `packages/server/src/services/bot-traits/growth-narrative.ts`
- Create: `packages/server/src/services/bot-traits/growth-narrative.test.ts`

**Goal:** Compare oldest snapshot vs current traits → Claude haiku produces a first-person growth narrative. Fallback to template if no history or Claude fails.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/bot-traits/growth-narrative.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-traits/growth-narrative.ts'),
  'utf-8',
);

describe('growth-narrative.ts structural', () => {
  it('exports generateGrowthNarrative async function', () => {
    expect(SRC).toMatch(/export async function generateGrowthNarrative\s*\(/);
  });
  it('returns "still getting to know you" message when no oldest snapshot', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    // Early return for null oldest — no Claude call.
    expect(fn).toMatch(/oldest\s*===?\s*null|!oldest/);
    expect(fn.toLowerCase()).toMatch(/узна|знаком/);
  });
  it('calls anthropic.messages.create with MODELS.haiku', () => {
    expect(SRC).toContain('anthropic.messages.create');
    expect(SRC).toContain('MODELS.haiku');
  });
  it('system prompt is first-person Russian comparing then vs now', () => {
    expect(SRC).toMatch(/ТОГДА|первого лица/);
    expect(SRC).toMatch(/СЕЙЧАС/);
  });
  it('best-effort try/catch with template fallback', () => {
    const fn = SRC.slice(SRC.indexOf('export async function generateGrowthNarrative'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/growth-narrative.test.ts
```

Expected: FAIL — `ENOENT`.

- [ ] **Step 3: Implement `growth-narrative.ts`**

Create `packages/server/src/services/bot-traits/growth-narrative.ts`:

```typescript
/**
 * v2.0 Phase B2 — growth narrative: the bot articulates how it changed.
 *
 * Spec §7. Compares oldest snapshot vs current traits via Claude haiku,
 * producing a warm first-person story. Best-effort: no history → friendly
 * "still getting to know you"; Claude failure → template fallback.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import type { BotTraits, TraitSnapshot } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const SYSTEM_PROMPT_TEMPLATE = (botName: string) =>
  `Ты — ${botName}, AI-друг. Опиши как ты ИЗМЕНИЛАСЬ в общении с
пользователем, сравнив свою персону ТОГДА и СЕЙЧАС.

ПРАВИЛА:
1. От первого лица («я стала...»).
2. 2-4 предложения. Тепло, искренне.
3. Описывай РЕАЛЬНУЮ дельту: что выросло, что осталось.
4. Без цифр в тексте — естественная речь.
5. Только русский. Без markdown.`;

export async function generateGrowthNarrative(
  oldest: TraitSnapshot | null,
  current: BotTraits,
  botName: string,
): Promise<string> {
  // No history yet — friendly placeholder, no Claude call.
  if (!oldest) {
    return 'Мы ещё узнаём друг друга. Со временем я подстроюсь под тебя — ' +
      'стану такой, какой тебе нужен друг.';
  }

  const fallback =
    'За это время я стала ближе к тебе — чувствую, что понимаю тебя лучше, ' +
    'чем в начале.';

  try {
    const userContent =
      `ТОГДА: warmth ${oldest.warmth.toFixed(2)}, directness ${oldest.directness.toFixed(2)}, ` +
      `humor ${oldest.humor.toFixed(2)}, playfulness ${oldest.playfulness.toFixed(2)}, ` +
      `depth ${oldest.depth.toFixed(2)}\n` +
      `СЕЙЧАС: warmth ${current.warmth.toFixed(2)}, directness ${current.directness.toFixed(2)}, ` +
      `humor ${current.humor.toFixed(2)}, playfulness ${current.playfulness.toFixed(2)}, ` +
      `depth ${current.relationshipDepth.toFixed(2)}`;

    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 300,
      system: SYSTEM_PROMPT_TEMPLATE(botName),
      messages: [{ role: 'user', content: userContent }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text' || !content.text.trim()) {
      return fallback;
    }
    return content.text.trim();
  } catch (err) {
    console.warn('[bot-traits:growth-narrative] failed:', err);
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/bot-traits/growth-narrative.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/bot-traits/growth-narrative.ts \
        packages/server/src/services/bot-traits/growth-narrative.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): growth-narrative Claude haiku self-story (C2)

Spec §7. generateGrowthNarrative compares oldest BotTraitSnapshot vs
current traits, asks Claude haiku for a warm 2-4 sentence first-person
story ("я стала прямее, потому что ты ценишь честность").

Graceful degradation:
- no oldest snapshot (< 2 weeks history) → "ещё узнаём друг друга"
  message, no Claude call
- Claude empty/429/network → template fallback, never throws

+8 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section D — Wiring (2 tasks)

### Task D1: Flag + tone enrichment + orchestrator refresh hook

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/lib/feature-flags.test.ts`
- Modify: `packages/server/src/services/v2-enrichment.ts`
- Modify: `packages/server/src/services/v2-enrichment.test.ts`
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`

**Goal:** Atomic wiring: (1) `isV2IdentityEnabled` flag, (2) tone section in enrichment block, (3) lazy `refreshTraitsIfStale` hook before prompt build.

- [ ] **Step 1: Append failing tests for feature flag**

Append to `packages/server/src/lib/feature-flags.test.ts`:

```typescript
describe('isV2IdentityEnabled', () => {
  const orig = process.env.FEATURE_V2_IDENTITY;
  afterEach(() => {
    if (orig === undefined) delete process.env.FEATURE_V2_IDENTITY;
    else process.env.FEATURE_V2_IDENTITY = orig;
  });
  it('unset → false', () => {
    delete process.env.FEATURE_V2_IDENTITY;
    expect(isV2IdentityEnabled('user-abc')).toBe(false);
  });
  it('none/false → false', () => {
    process.env.FEATURE_V2_IDENTITY = 'none';
    expect(isV2IdentityEnabled('abc')).toBe(false);
    process.env.FEATURE_V2_IDENTITY = 'false';
    expect(isV2IdentityEnabled('abc')).toBe(false);
  });
  it('all/true → true', () => {
    process.env.FEATURE_V2_IDENTITY = 'all';
    expect(isV2IdentityEnabled('anybody')).toBe(true);
    process.env.FEATURE_V2_IDENTITY = 'true';
    expect(isV2IdentityEnabled('anybody')).toBe(true);
  });
  it('per-user comma list', () => {
    process.env.FEATURE_V2_IDENTITY = 'user-abc,user-def';
    expect(isV2IdentityEnabled('abc')).toBe(true);
    expect(isV2IdentityEnabled('xyz')).toBe(false);
  });
  it('tolerates whitespace', () => {
    process.env.FEATURE_V2_IDENTITY = '  user-abc , user-def ';
    expect(isV2IdentityEnabled('abc')).toBe(true);
  });
});
```

- [ ] **Step 2: Append failing tests for enrichment + orchestrator wiring**

Append to `packages/server/src/services/v2-enrichment.test.ts`:

```typescript
describe('v2-enrichment — tone section wiring (D1)', () => {
  it('imports getBotTraitsStore + formatToneSection + isV2IdentityEnabled', () => {
    const s = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
    expect(s).toContain('getBotTraitsStore');
    expect(s).toContain('formatToneSection');
    expect(s).toContain('isV2IdentityEnabled');
  });
  it('tone section appended under flag', () => {
    const s = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
    expect(s).toMatch(/isV2IdentityEnabled\(\s*userId\s*\)/);
    expect(s).toMatch(/formatToneSection\(/);
  });
});
```

Create `packages/server/src/services/jarvis-identity-hook.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — identity refresh hook (D1)', () => {
  it('imports getBotTraitsStore + isV2IdentityEnabled', () => {
    expect(SRC).toContain('getBotTraitsStore');
    expect(SRC).toMatch(/isV2IdentityEnabled/);
  });
  it('calls refreshTraitsIfStale under flag', () => {
    expect(SRC).toMatch(/refreshTraitsIfStale\(/);
  });
  it('hook gated by isV2IdentityEnabled', () => {
    const idx = SRC.indexOf('refreshTraitsIfStale');
    expect(idx).toBeGreaterThan(0);
    const window = SRC.slice(Math.max(0, idx - 400), idx);
    expect(window).toMatch(/isV2IdentityEnabled\(\s*userId\s*\)/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/server
npm test -- --reporter=verbose \
  src/lib/feature-flags.test.ts \
  src/services/v2-enrichment.test.ts \
  src/services/jarvis-identity-hook.test.ts
```

Expected: new tests FAIL.

- [ ] **Step 4: Add `isV2IdentityEnabled` to feature-flags.ts**

Edit `packages/server/src/lib/feature-flags.ts`. Add after `isV2AxesEnabled`:

```typescript
/**
 * v2 Phase B2 — Per-user gate for bot Identity Evolution feature.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2IdentityEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_IDENTITY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 5: Add tone section to v2-enrichment.ts**

Edit `packages/server/src/services/v2-enrichment.ts`. Add to imports:

```typescript
import { getBotTraitsStore } from './bot-traits/index.js';
import { formatToneSection } from './bot-traits/tone-section.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';
import { prisma } from '../lib/prisma.js';
```

(If `prisma` already imported, skip that line.)

In the function that composes the enrichment block (where the axes section
is appended — from B1 D1), after the axes block, add:

```typescript
  // v2 Phase B2 — tone section (bot persona)
  if (isV2IdentityEnabled(userId)) {
    try {
      const traits = await getBotTraitsStore().getTraits(userId);
      const msgCount = await prisma.chatMessage.count({ where: { userId } });
      const toneSection = formatToneSection(traits, msgCount);
      if (toneSection) {
        block += '\n\n' + toneSection;
      }
    } catch (err) {
      console.warn('[v2-enrichment:tone] failed:', err);
    }
  }
```

(Use whatever the block variable is named in the existing function — match
the axes integration from B1 D1.)

- [ ] **Step 6: Add refresh hook to jarvis-orchestrator.ts**

Edit `packages/server/src/services/jarvis-orchestrator.ts`. Add to imports:

```typescript
import { getBotTraitsStore } from './bot-traits/index.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';
```

In `handleMessage`, BEFORE the system-prompt construction (so refreshed
traits are visible to the enrichment block), add:

```typescript
  // v2 Phase B2 — lazy refresh bot traits (recompute if stale > 6h).
  // Cheap (pure compute + small queries); persists into BotIdentity.traits
  // so the enrichment block's getTraits sees fresh values.
  if (isV2IdentityEnabled(userId)) {
    try {
      await getBotTraitsStore().refreshTraitsIfStale(userId);
    } catch (err) {
      console.warn('[orchestrator:identity-refresh] failed:', err);
    }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd packages/server
npm test -- --reporter=verbose \
  src/lib/feature-flags.test.ts \
  src/services/v2-enrichment.test.ts \
  src/services/jarvis-identity-hook.test.ts
```

Expected: all pass.

- [ ] **Step 8: Full suite + tsc + legacy gating check**

```bash
cd packages/server
npm test
npx tsc --noEmit
npm test -- src/services/orchestrator-gating.test.ts
```

Expected: all green, tsc clean, orchestrator-gating 40/40 (legacy path unaffected).

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts \
        packages/server/src/lib/feature-flags.test.ts \
        packages/server/src/services/v2-enrichment.ts \
        packages/server/src/services/v2-enrichment.test.ts \
        packages/server/src/services/jarvis-orchestrator.ts \
        packages/server/src/services/jarvis-identity-hook.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity-wiring): flag + tone enrichment + orchestrator refresh (D1)

Three-part atomic wiring:
1. isV2IdentityEnabled(userId) — same shape as isV2AxesEnabled.
2. v2-enrichment: append formatToneSection(traits, msgCount) under flag,
   after the axes block. Best-effort.
3. jarvis-orchestrator: refreshTraitsIfStale(userId) before prompt build
   (gated) so the enrichment block sees fresh traits. Lazy — recomputes
   only if > 6h stale; cheap pure compute, no Claude.

When flag off → no tone block, no refresh, byte-identical to pre-B2.
orchestrator-gating 40/40 green.

+11 tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: `detectIdentityGrowth` proactivity detector

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`

**Goal:** Add a detector that emits a rare (max 1/month, depth-shift ≥0.15) self-aware growth comment candidate, wired into the engine's `detectCandidates`. Nudge text = growth narrative.

- [ ] **Step 1: Append failing structural tests**

Append to `packages/server/src/services/v2-proactivity-engine.test.ts`:

```typescript
describe('v2-proactivity-engine — identity growth detector (B2 D2)', () => {
  it('detectIdentityGrowth defined', () => {
    expect(SRC).toMatch(/detectIdentityGrowth/);
  });
  it('uses getBotTraitsStore snapshotHistory', () => {
    const start = SRC.indexOf('detectIdentityGrowth');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('getBotTraitsStore');
    expect(body).toContain('snapshotHistory');
  });
  it('30-day dedup via Insight kind=identity_growth', () => {
    const start = SRC.indexOf('detectIdentityGrowth');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('identity_growth');
    expect(body).toMatch(/30/);
  });
  it('depth-shift threshold 0.15', () => {
    const start = SRC.indexOf('detectIdentityGrowth');
    const body = SRC.slice(start, start + 2500);
    expect(body).toMatch(/0\.15/);
  });
  it('wired into detectCandidates', () => {
    const start = SRC.indexOf('detectCandidates');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('detectIdentityGrowth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```

Expected: new tests FAIL.

- [ ] **Step 3: Add detector + wire into detectCandidates**

Edit `packages/server/src/services/v2-proactivity-engine.ts`. Add to imports:

```typescript
import { getBotTraitsStore } from './bot-traits/index.js';
import { generateGrowthNarrative } from './bot-traits/growth-narrative.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
```

(If `getBotIdentityService` import differs in the codebase, match the
existing pattern used elsewhere — search for how botName is fetched.)

Add the detector function (near the other `detect*` functions):

```typescript
/**
 * v2 Phase B2 — rare self-aware growth comment. Fires at most once per
 * month, only when relationshipDepth has shifted ≥ 0.15 since the last
 * comment (or oldest snapshot). The nudge text is a warm first-person
 * growth narrative. Best-effort: never throws.
 */
async function detectIdentityGrowth(userId: string): Promise<NudgeCandidate[]> {
  try {
    const store = getBotTraitsStore();
    const history = await store.snapshotHistory(userId, 50);
    if (history.length < 2) return [];
    const current = await store.getTraits(userId);

    // 30-day dedup: last identity_growth comment.
    const lastComment = await prisma.insight.findFirst({
      where: { userId, source: 'v2-proactivity', kind: 'identity_growth' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const daysSince = lastComment
      ? (Date.now() - lastComment.createdAt.getTime()) / 86400_000
      : Infinity;
    if (daysSince < 30) return [];

    // Baseline = first snapshot after last comment, else oldest snapshot.
    const baseline = lastComment
      ? history.find((h) => h.recordedAt > lastComment.createdAt) ?? history[0]
      : history[0];
    const depthShift = current.relationshipDepth - baseline.depth;
    if (depthShift < 0.15) return [];

    return [{
      source: 'identity_growth',
      significance: Math.min(1, depthShift * 3),
      payload: { depthShift, baseline, current },
      toneHint: 'warm',
    }];
  } catch (err) {
    console.warn('[proactivity:identity-growth] failed:', err);
    return [];
  }
}
```

In `detectCandidates` (the aggregator that runs all detectors via
`Promise.allSettled`), add `detectIdentityGrowth(userId)` to the array of
detector calls.

In the nudge-generation path (where `generateNudge` builds text per
candidate source), add a branch for `identity_growth`:

```typescript
  if (candidate.source === 'identity_growth') {
    try {
      const identity = await getBotIdentityService().getIdentity(userId);
      const payload = candidate.payload as {
        baseline: { warmth: number; directness: number; humor: number; playfulness: number; depth: number; recordedAt: Date };
        current: { warmth: number; directness: number; humor: number; playfulness: number; relationshipDepth: number };
      };
      return await generateGrowthNarrative(
        { ...payload.baseline },
        { ...payload.current, lastComputedAt: null },
        identity.botName,
      );
    } catch {
      return 'Знаешь, я заметила, что мы стали ближе за это время. Мне нравится, какими мы стали.';
    }
  }
```

(Integrate where the existing source-based nudge text is selected — match
the structure in `generateNudge`. The `NudgeSource` union type must also
gain `'identity_growth'` — add it where the union is declared.)

Also add `'identity_growth'` to the `NudgeSource` type union and the
`scoreSignificance` switch (return `c.significance` directly since it's
precomputed, or `Math.min(1, (c.payload.depthShift as number) * 3)`).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/v2-proactivity-engine.ts \
        packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity): detectIdentityGrowth proactivity detector (D2)

Spec §8 — Berik-approved rare self-aware growth comment. New detector
wired into detectCandidates:
- requires ≥2 snapshots
- 30-day dedup via Insight kind='identity_growth'
- only fires when relationshipDepth shifted ≥ 0.15 since last comment
- significance = min(1, depthShift·3), then standard 4-gate applies
- nudge text = generateGrowthNarrative (warm first-person)

Added 'identity_growth' to NudgeSource union + scoreSignificance.
Max ~1/month by construction. Best-effort.

+8 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section E — Telegram + Cron + Bootstrap (3 tasks)

### Task E1: `/identity` Telegram command

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts`
- Create: `packages/server/src/services/telegram-identity.test.ts`

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/telegram-identity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'),
  'utf-8',
);

describe('telegram-bot.ts — /identity command (E1)', () => {
  it('registers bot.command("identity", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*'identity'/);
  });
  it('reads getBotTraitsStore + generateGrowthNarrative', () => {
    expect(SRC).toContain('getBotTraitsStore');
    expect(SRC).toContain('generateGrowthNarrative');
  });
  it('gated by isV2IdentityEnabled', () => {
    const idx = SRC.indexOf("bot.command('identity'");
    expect(idx).toBeGreaterThan(0);
    const region = SRC.slice(idx, idx + 1500);
    expect(region).toContain('isV2IdentityEnabled');
  });
  it('shows all 4 traits', () => {
    const idx = SRC.indexOf("bot.command('identity'");
    const region = SRC.slice(idx, idx + 2500);
    expect(region).toContain('warmth');
    expect(region).toContain('directness');
    expect(region).toContain('humor');
    expect(region).toContain('playfulness');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/telegram-identity.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add `/identity` handler**

Edit `packages/server/src/services/telegram-bot.ts`. Add to imports:

```typescript
import { getBotTraitsStore } from './bot-traits/index.js';
import { traitLabel } from './bot-traits/index.js';
import { generateGrowthNarrative } from './bot-traits/growth-narrative.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';
```

(Skip any already-imported symbol.)

Add handler near other `bot.command(...)`:

```typescript
// v2 Phase B2 — /identity persona + growth narrative
bot.command('identity', async (ctx) => {
  if (!ctx.message) return;
  try {
    const user = await findOrCreateUser(ctx);
    if (!isV2IdentityEnabled(user.id)) {
      await ctx.reply('Identity evolution выключена для тебя.');
      return;
    }
    const text = await formatIdentityForTelegram(user.id);
    await ctx.reply(text);
  } catch (err) {
    console.warn('[telegram:identity] failed:', err);
    await ctx.reply('Не получилось показать identity. Попробуй позже.');
  }
});

async function formatIdentityForTelegram(userId: string): Promise<string> {
  const store = getBotTraitsStore();
  const traits = await store.getTraits(userId);
  const identity = await getBotIdentityService().getIdentity(userId);
  const history = await store.snapshotHistory(userId, 50);
  const oldest = history.length >= 2 ? history[0] : null;
  const narrative = await generateGrowthNarrative(oldest, traits, identity.botName);

  const lines: string[] = [
    `Я — ${identity.botName} ${identity.avatar}`,
    '',
    'Сейчас с тобой я:',
    `🔥 warmth: ${traits.warmth.toFixed(2)} (${traitLabel(traits.warmth)})`,
    `🎯 directness: ${traits.directness.toFixed(2)} (${traitLabel(traits.directness)})`,
    `😄 humor: ${traits.humor.toFixed(2)} (${traitLabel(traits.humor)})`,
    `⚡ playfulness: ${traits.playfulness.toFixed(2)} (${traitLabel(traits.playfulness)})`,
    '',
    `Глубина связи: ${traits.relationshipDepth.toFixed(2)}`,
    '',
    'Как я изменилась:',
    narrative,
  ];
  return lines.join('\n');
}
```

(If `getBotIdentityService` isn't already imported in telegram-bot.ts,
add `import { getBotIdentityService } from './bot-identity.singleton.js';`
— it's used by `/setname` from Week 5, so likely already present.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/telegram-identity.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/telegram-bot.ts \
        packages/server/src/services/telegram-identity.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity-telegram): /identity persona + growth narrative (E1)

Telegram command shows the bot's current persona (4 traits + labels +
relationship depth) and a growth narrative (Claude haiku comparing oldest
snapshot vs now, or "ещё узнаём друг друга" if < 2 weeks history).

Gated by isV2IdentityEnabled — off → "feature disabled" instead of
leaking machinery. Errors → friendly fallback.

+5 structural tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E2: Weekly `bot-traits-snapshot` cron

**Files:**
- Modify: `packages/server/src/services/proactive-scheduler.ts`
- Create: `packages/server/src/services/scheduler-identity-cron.test.ts`

**Goal:** Weekly job that refreshes traits + writes a snapshot for active users, via `withCronLock` (Week 6 primitive), gated by `isV2CronEnabled()`.

- [ ] **Step 1: Write failing structural tests**

Create `packages/server/src/services/scheduler-identity-cron.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'),
  'utf-8',
);

describe('proactive-scheduler — bot-traits-snapshot cron (E2)', () => {
  it('imports getBotTraitsStore', () => {
    expect(SRC).toContain('getBotTraitsStore');
  });
  it('uses withCronLock with bot-traits-snapshot job name + weekly interval', () => {
    expect(SRC).toMatch(/withCronLock\(\s*['"]bot-traits-snapshot['"]/);
    expect(SRC).toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
  it('refreshTraits + snapshot per user', () => {
    const idx = SRC.indexOf('bot-traits-snapshot');
    const body = SRC.slice(Math.max(0, idx - 200), idx + 1200);
    expect(body).toContain('refreshTraits');
    expect(body).toContain('snapshot');
  });
  it('gated by isV2CronEnabled', () => {
    const idx = SRC.indexOf('bot-traits-snapshot');
    const window = SRC.slice(Math.max(0, idx - 800), idx);
    expect(window).toContain('isV2CronEnabled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/scheduler-identity-cron.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add cron to proactive-scheduler.ts**

Edit `packages/server/src/services/proactive-scheduler.ts`. Add to imports:

```typescript
import { getBotTraitsStore } from './bot-traits/index.js';
```

Inside `tick()`, alongside the existing `mood-retention` and
`pattern-extraction` cron blocks (both already gated by `isV2CronEnabled()`),
add a third cron — keep it inside the same `if (isV2CronEnabled())` region
where the others live:

```typescript
      // v2 Phase B2 — weekly bot-traits snapshot + refresh.
      try {
        await withCronLock('bot-traits-snapshot', 7 * 24 * 60 * 60 * 1000, null, async () => {
          const store = getBotTraitsStore();
          // Reuse the active-user set already computed for pattern-extraction
          // if available; otherwise fetch users active in last 7 days.
          const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const activeUserRows = await prisma.chatMessage.findMany({
            where: { createdAt: { gte: since } },
            select: { userId: true },
            distinct: ['userId'],
          });
          for (const { userId } of activeUserRows) {
            try {
              await store.refreshTraits(userId);
              await store.snapshot(userId);
            } catch (err) {
              console.warn(`[cron:bot-traits] user=${userId}:`, err);
            }
          }
          console.log(`[cron:bot-traits] snapshotted ${activeUserRows.length} active users`);
        });
      } catch (err) {
        console.warn('[cron:bot-traits] tick failed:', err);
      }
```

(Match the exact placement/style of the existing two crons. `withCronLock`
and `prisma` are already imported there from Week 6.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/scheduler-identity-cron.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc + scheduler-v2 regression**

```bash
cd packages/server
npm test
npx tsc --noEmit
npm test -- src/services/proactive-scheduler-v2.test.ts src/services/proactive-scheduler-v2-cron.test.ts
```

Expected: all green (Week 5/6 scheduler tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/proactive-scheduler.ts \
        packages/server/src/services/scheduler-identity-cron.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity-cron): weekly bot-traits snapshot + refresh (E2)

Third scheduler cron (alongside mood-retention + pattern-extraction),
gated by isV2CronEnabled, idempotent via withCronLock('bot-traits-
snapshot', 7d). For each user active in the last 7 days: refreshTraits
(recompute depth + traits) then snapshot (write BotTraitSnapshot row).

The weekly snapshot is what powers the growth narrative over time —
without it there's no "then vs now" to compare.

+4 structural tests. Week 5/6 scheduler tests unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task E3: `bootstrap-traits.ts` script

**Files:**
- Create: `packages/server/scripts/bootstrap-traits.ts`
- Create: `packages/server/src/scripts/bootstrap-traits.test.ts`

**Goal:** One-time CLI that computes initial traits for an existing user + writes the first snapshot (the baseline for narrative).

- [ ] **Step 1: Write failing tests (dynamic-import pattern)**

Create `packages/server/src/scripts/bootstrap-traits.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let parseCliArgs: (argv: string[]) => any;
let SCRIPT: string;

beforeAll(async () => {
  const modulePath = new URL('../../scripts/bootstrap-traits.js', import.meta.url).href;
  const mod = await import(modulePath);
  parseCliArgs = mod.parseCliArgs;
  const testDir = dirname(new URL(import.meta.url).pathname);
  SCRIPT = readFileSync(join(testDir, '..', '..', 'scripts', 'bootstrap-traits.ts'), 'utf-8');
});

describe('bootstrap-traits — parseCliArgs', () => {
  it('--user=X --dry-run', () => {
    expect(parseCliArgs(['--user=abc', '--dry-run'])).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
  it('--user=X --apply', () => {
    expect(parseCliArgs(['--user=abc', '--apply'])).toEqual({ userId: 'abc', mode: 'apply' });
  });
  it('rejects missing user', () => {
    expect('error' in parseCliArgs(['--dry-run'])).toBe(true);
  });
  it('rejects empty user', () => {
    expect('error' in parseCliArgs(['--user=', '--apply'])).toBe(true);
  });
  it('rejects no mode', () => {
    expect('error' in parseCliArgs(['--user=abc'])).toBe(true);
  });
  it('rejects both modes', () => {
    expect('error' in parseCliArgs(['--user=abc', '--dry-run', '--apply'])).toBe(true);
  });
});

describe('bootstrap-traits structural', () => {
  it('computes RelationshipStats from real data', () => {
    expect(SCRIPT).toContain('chatMessage.count');
    expect(SCRIPT).toContain('entity.count');
    expect(SCRIPT).toContain('moodSnapshot');
  });
  it('calls refreshTraits + snapshot in apply mode', () => {
    expect(SCRIPT).toContain('refreshTraits');
    expect(SCRIPT).toContain('snapshot');
  });
  it('uses getBotTraitsStore', () => {
    expect(SCRIPT).toContain('getBotTraitsStore');
  });
  it('disconnects prisma + exit 1 on parse error', () => {
    expect(SCRIPT).toMatch(/\$disconnect/);
    expect(SCRIPT).toMatch(/process\.exit\(1\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/scripts/bootstrap-traits.test.ts
```

Expected: FAIL — `ENOENT`.

- [ ] **Step 3: Implement `bootstrap-traits.ts`**

Create `packages/server/scripts/bootstrap-traits.ts`:

```typescript
/**
 * v2.0 Phase B2 — one-time bootstrap of bot traits for an existing user.
 *
 * Spec §11. Computes initial traits from accumulated data and writes the
 * first BotTraitSnapshot (baseline for the growth narrative).
 *
 * Usage:
 *   npx tsx packages/server/scripts/bootstrap-traits.ts --user=<id> --dry-run
 *   npx tsx packages/server/scripts/bootstrap-traits.ts --user=<id> --apply
 *
 * Idempotent-ish: re-running recomputes + adds another snapshot row
 * (harmless — narrative uses oldest, snapshots accumulate weekly anyway).
 */

import { PrismaClient } from '@prisma/client';
import { getBotTraitsStore } from '../src/services/bot-traits/index.js';

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

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('bootstrap-traits:', parsed.error);
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();
  const tag = mode === 'dry-run' ? '[dry-run]' : '[apply]';
  console.log(`[bootstrap-traits] user=${userId} mode=${mode}`);

  try {
    // Show the stats that drive the computation.
    const [messageCount, firstMsg, distinctEntities, emotionalMoments] =
      await Promise.all([
        prisma.chatMessage.count({ where: { userId } }),
        prisma.chatMessage.findFirst({
          where: { userId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true },
        }),
        prisma.entity.count({ where: { userId } }),
        prisma.moodSnapshot.count({
          where: { userId, OR: [{ valence: { gt: 0.4 } }, { valence: { lt: -0.4 } }] },
        }),
      ]);
    const daysSinceFirst = firstMsg
      ? Math.max(0, (Date.now() - firstMsg.createdAt.getTime()) / 86400_000)
      : 0;
    console.log(`${tag} stats: msgs=${messageCount} days=${daysSinceFirst.toFixed(1)} entities=${distinctEntities} emotional=${emotionalMoments}`);

    if (mode === 'dry-run') {
      console.log(`${tag} would refreshTraits + write first snapshot (no DB writes)`);
      return;
    }

    const store = getBotTraitsStore();
    const traits = await store.refreshTraits(userId);
    await store.snapshot(userId);
    console.log(`${tag} ✓ Applied. Traits: warmth=${traits.warmth.toFixed(2)} directness=${traits.directness.toFixed(2)} humor=${traits.humor.toFixed(2)} playfulness=${traits.playfulness.toFixed(2)} depth=${traits.relationshipDepth.toFixed(2)}`);
  } catch (err) {
    console.error('bootstrap-traits failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1]?.endsWith('bootstrap-traits.ts') ||
  process.argv[1]?.endsWith('bootstrap-traits.js')
) {
  main().catch((e) => {
    console.error('bootstrap-traits fatal:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/scripts/bootstrap-traits.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + tsc**

```bash
cd packages/server
npm test
npx tsc --noEmit
```

Expected: green, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/scripts/bootstrap-traits.ts \
        packages/server/src/scripts/bootstrap-traits.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-identity-migration): bootstrap-traits.ts one-time init (E3)

CLI (mirrors bootstrap-axes pattern, dynamic-import test) that computes
initial bot traits for an existing user from their accumulated data
(ChatMessage count, tenure, Entity count, emotional MoodSnapshots) and
writes the first BotTraitSnapshot — the baseline the growth narrative
compares against.

--dry-run shows the driving stats; --apply runs refreshTraits + snapshot.

+10 tests (parseCliArgs unit + structural).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section F — Verify (1 task)

### Task F1: Integration test + final verify + progress commit

**Files:**
- Create: `packages/server/src/__integration__/v2-identity-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

- [ ] **Step 1: Write integration structural test**

Create `packages/server/src/__integration__/v2-identity-flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const ENRICH = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf-8');
const SCHED = readFileSync(join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');
const ENGINE = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('v2 identity flow — inbound tone', () => {
  it('orchestrator refreshes traits then enrichment renders tone', () => {
    expect(ORCH).toMatch(/refreshTraitsIfStale\(/);
    expect(ENRICH).toContain('formatToneSection');
  });
  it('both gated by isV2IdentityEnabled', () => {
    expect(ORCH).toContain('isV2IdentityEnabled');
    expect(ENRICH).toContain('isV2IdentityEnabled');
  });
});

describe('v2 identity flow — weekly snapshot', () => {
  it('scheduler runs bot-traits-snapshot cron', () => {
    expect(SCHED).toMatch(/bot-traits-snapshot/);
    expect(SCHED).toContain('snapshot');
  });
});

describe('v2 identity flow — proactive growth comment', () => {
  it('engine has identity_growth detector wired', () => {
    expect(ENGINE).toContain('detectIdentityGrowth');
    expect(ENGINE).toContain('identity_growth');
  });
});
```

- [ ] **Step 2: Run it (expect green — verifies existing wiring)**

```bash
cd packages/server
npm test -- --reporter=verbose src/__integration__/v2-identity-flow.test.ts
```

Expected: all pass.

- [ ] **Step 3: Full suite**

```bash
cd packages/server
npm test
```

Expected: all green. Baseline 1529 + ~106 B2 tests → ~1635.

- [ ] **Step 4: tsc + vi.mock + placeholder scan**

```bash
cd packages/server
npx tsc --noEmit
grep -r "vi\.mock" packages/server/src/ | wc -l           # expect 0
grep -rn "not yet implemented" packages/server/src/services/bot-traits/  # expect empty
```

Expected: tsc clean, 0 vi.mock, no placeholder throws.

- [ ] **Step 5: Verify file structure**

```bash
ls packages/server/src/services/bot-traits/
ls packages/server/scripts/bootstrap-traits.ts
```

Expected: types/postgres-impl/index/tone-section/growth-narrative (+ tests),
and bootstrap-traits.ts.

- [ ] **Step 6: Smoke bootstrap dry-run against local Docker**

```bash
cd packages/server
docker exec server-postgres-1 psql -U postgres -d lifeos_dev \
  -c "INSERT INTO \"User\" (id, email, name, \"passwordHash\", \"createdAt\")
      VALUES ('test-bt-user', 'bt@example.com', 'BT', 'hash', NOW() - INTERVAL '40 days')
      ON CONFLICT (id) DO NOTHING;"
DATABASE_URL='postgresql://postgres:dev@localhost:5432/lifeos_dev' \
  npx tsx scripts/bootstrap-traits.ts --user=test-bt-user --dry-run
```

Expected: prints stats line + `would refreshTraits + write first snapshot`.

- [ ] **Step 7: Update progress tracker**

Edit `docs/plan/v2-memory-proactivity-scope.md`. Add row after the B1 row:

```markdown
| 9 (B2) | Phase B2 — Identity Evolution (BOT axes / emergent persona) | ✅ done | 2026-05-31 | 13 atomic commits + F1 progress; +106 tests (1529→~1635); tsc clean; 0 vi.mock; 0 placeholders; flag FEATURE_V2_IDENTITY default off. 4 bot traits (warmth/directness/humor/playfulness) + relationshipDepth, tone enrichment, growth narrative, /identity command, weekly snapshot cron, rare KAIROS-gated growth comment (max 1/mo), bootstrap. Reuses B1 axes. Spec: docs/superpowers/specs/2026-05-31-v2-phase-b2-identity-evolution-design.md. Plan: docs/superpowers/plans/2026-05-31-v2-phase-b2-identity-evolution.md |
```

- [ ] **Step 8: Final commit**

```bash
git add packages/server/src/__integration__/v2-identity-flow.test.ts \
        docs/plan/v2-memory-proactivity-scope.md
git commit -m "$(cat <<'EOF'
docs(v2-progress): Phase B2 DONE — Identity Evolution (BOT axes)

13 atomic commits implementing emergent bot persona:
- A1 BotTraitSnapshot schema + migration
- B1-B4 types + pure helpers + Postgres impl + singleton
- C1-C2 tone section + growth narrative
- D1-D2 flag/enrichment/orchestrator wiring + identity_growth detector
- E1-E3 /identity command + weekly snapshot cron + bootstrap

1529 → ~1635 tests pass (+106). tsc clean, 0 vi.mock, 0 placeholders.
FEATURE_V2_IDENTITY default off — byte-identical to pre-B2 in prod.

Bot now adapts TONE to user's B1 axes and deepens with relationship
(depth grows → warmer/more direct/playful over months), can articulate
its own growth via /identity, and rarely (max 1/mo, KAIROS-gated) shares
a self-aware growth comment.

Phase B remaining: B3 Cross-session learning, B4 Hermes skill creation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec Coverage

| Spec section | Task |
|---|---|
| §2.1 Components | A1 (schema), B1-B4 (service), C1-C2 (tone+narrative), D1-D2 (wiring+detector), E1-E3 (telegram/cron/bootstrap) |
| §3 BOT traits (4 + depth) | B1 types + BOT_TRAIT_NAMES |
| §4.1 BotTraitSnapshot schema | A1 |
| §4.2 BotTraitsStore API | B1 interface, B2-B3 impl |
| §4.3 Migration SQL | A1 |
| §5 Computation (pure) | B1 logNorm/computeRelationshipDepth/computeBotTraits |
| §6 Tone enrichment | C1 formatToneSection + D1 integration |
| §7 Growth narrative | C2 |
| §8 Proactive growth comment (KAIROS) | D2 detectIdentityGrowth |
| §9 /identity command | E1 |
| §10 Weekly snapshot cron | E2 |
| §11 Bootstrap | E3 |
| §12 Failure modes | best-effort try/catch in B2/B3/C2/D2/E2 + flag gates |
| §13 Test strategy | each task unit+structural; F1 integration + totals |
| §14 Rollout flag | D1 isV2IdentityEnabled |

All implementation-bearing spec sections covered.

### 2. Placeholder Scan

- B2 has intentional `throw new Error('... not yet implemented — Task B3')`
  stubs for refreshTraitsIfStale/snapshot/snapshotHistory — REPLACED in B3.
- F1 Step 4 greps to confirm zero remain.
- No other placeholders.

### 3. Type Consistency

| Symbol | Defined | Used |
|---|---|---|
| `BotTraitName` / `BOT_TRAIT_NAMES` | B1 types.ts | B4 re-export, C1 (implicit), tests |
| `BotTraits` | B1 | B2-B3 (return), C1 (formatToneSection input), C2 (narrative input), E1 |
| `RelationshipStats` | B1 | B2 refreshTraits, E3 bootstrap |
| `TraitSnapshot` | B1 | B3 snapshotHistory, C2 narrative, D2 detector |
| `BotTraitsStore` | B1 | B2 implements, B4 singleton typedef |
| `DEFAULT_TRAITS` | B1 | B2 getTraits fallback, C-tests |
| `logNorm`/`computeRelationshipDepth`/`computeBotTraits`/`traitLabel`/`parseTraitsJson` | B1 | B2 (compute), C1 (traitLabel), B4 re-export |
| `getBotTraitsStore`/`_resetBotTraitsForTests` | B4 | D1 (orchestrator), D2 (detector), E1 (telegram), E2 (cron), E3 (bootstrap) |
| `formatToneSection` | C1 | D1 enrichment |
| `generateGrowthNarrative` | C2 | D2 nudge, E1 telegram |
| `isV2IdentityEnabled` | D1 feature-flags | D1 enrichment+orchestrator, E1 telegram |
| `detectIdentityGrowth` | D2 | D2 detectCandidates wiring |

All consistent. No drift.

### 4. Test Pattern Compliance

- Zero `vi.mock` — pure unit (helpers) + structural (`readFileSync`+grep);
  script test uses dynamic-import (per bootstrap-axes). Verified F1 Step 4.
- Pure helpers exported: logNorm, computeRelationshipDepth, computeBotTraits,
  traitLabel, parseTraitsJson, formatToneSection, parseCliArgs.
- Singleton reset `_resetBotTraitsForTests` mirrors `_resetUserAxesForTests`.

### 5. Edge Case Enumeration

| Edge case | Where handled |
|---|---|
| B1 axes flag off | B2 refreshTraits — getAxes returns 0.5 defaults, traits still computed |
| Malformed traits JSON | B1 parseTraitsJson defaults, never throws |
| Claude narrative 429/network | C2 try/catch → template fallback |
| No snapshot history (< 2) | C2 early "ещё узнаём" return; D2 detector returns [] |
| depth div-by-zero | B1 logNorm guards value<=0 |
| refreshTraits DB failure | B2 catch → getTraits |
| Snapshot table growth | weekly ~52/yr/user — negligible, no retention |
| Growth comment spam | D2 30-day dedup + 4-gate |
| Tone change abrupt | depth slow (logNorm + weekly snapshot) |
| Flag flip mid-session | every entry re-checks isV2IdentityEnabled |
| Race on refreshTraits | last-writer-wins, deterministic value |
| Account delete | FK CASCADE on BotTraitSnapshot (A1) |

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-v2-phase-b2-identity-evolution.md`.**

**Summary:** 13 tasks, ~80 TDD steps, ~106 new tests. Implements BOT Identity Evolution — 4 traits + relationshipDepth, deterministic from B1 axes + tenure, tone enrichment in system prompt, Claude-haiku growth narrative, `/identity` command, weekly snapshot cron, rare KAIROS-gated self-aware growth comment, one-time bootstrap. Feature-flag gated; byte-identical when off.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Use skill: `superpowers:subagent-driven-development`.

**2. Inline Execution** — tasks run in this session using `superpowers:executing-plans`, with checkpoints.

**Which approach?**

---

## Reporting back

- **Plan line count:** ~2200 lines (within target).
- **Task count:** 13 atomic tasks (A1, B1-B4, C1-C2, D1-D2, E1-E3, F1).
- **Total TDD step count:** ~80 numbered steps.
- **Files:** 14 new (7 source + 7 test), 7 modified.
- **Key compliance:** zero `vi.mock`, pure helpers unit-tested, Claude best-effort + only for narrative/proactive (not hot path), feature-flag gated end-to-end, one atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
