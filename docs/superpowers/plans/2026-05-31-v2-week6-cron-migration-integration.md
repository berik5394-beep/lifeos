# v2.0 Week 6 — Cron tasks (mood-retention + pattern-extraction) + Migration script + Integration tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Week-6 trio that closes out the v2 memory/proactivity foundation: (1) two cron tasks (mood-retention daily, pattern-extraction weekly) wired into the existing 10-min scheduler tick with DB-backed idempotency via a new `CronJobRun` model; (2) a manual `migrate-to-v2.ts` script (dry-run/apply, single-user scope) that backfills `Memory.validAt`, lifts legacy `Memory` rows into the new `Entity` graph, seeds `BotIdentity`, and triggers one pattern-extraction pass; (3) three structural integration tests that lock the v2 consolidation flow, the v2 proactivity flow, and the migration script's wiring. **No new tools, no new prompts, no orchestrator changes.** The only schema change is `CronJobRun`. Old chat pipeline still behaves bit-identically when flags are off (Week 5 invariant preserved).

**Stack/decisions locked (Berik 2026-05-31):**
- Cron idempotency = DB table `CronJobRun` (not in-memory, not Redis) — survives restart, survives scale-out.
- Migration script = **manual** (`npx tsx scripts/migrate-to-v2.ts --user=<id> --dry-run|--apply`), single-user scope, no cron auto-run, no `--all-users`.
- Integration tests = 3 files (consolidation, proactivity, migration). v2-invalidation deferred to Phase B per Berik.
- No wiring changes to `jarvis-orchestrator.ts` (done in Week 5).
- No new agent tools (done in Week 5).
- Only schema change: new `CronJobRun` model.
- Cron tasks gated by **new** `isV2CronEnabled()` helper that reads `FEATURE_V2_CRON` env (`all` / `true` / unset). Per-user gating is not needed since both crons either iterate `User.findMany` themselves (pattern-extraction) or operate globally (mood-retention deletes per-user but the *job* is global).
- Zero `vi.mock`, one atomic commit per task, `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- 11 atomic tasks: A1-A5 (cron infra), B1-B2 (migration), C1-C3 (integration), D1 (verify).

**File map (created / modified):**

| File | Action | Task |
|---|---|---|
| `packages/server/prisma/schema.prisma` | +`CronJobRun` model | A1 |
| `packages/server/prisma/migrations/<ts>_v2_cron_jobs/migration.sql` | new (idempotent) | A1 |
| `packages/server/src/services/cron-runner.ts` | new | A2 |
| `packages/server/src/services/cron-runner.test.ts` | new | A2 |
| `packages/server/src/services/cron/mood-retention-cron.ts` | new | A3 |
| `packages/server/src/services/cron/mood-retention-cron.test.ts` | new | A3 |
| `packages/server/src/services/cron/pattern-extraction-cron.ts` | new | A4 |
| `packages/server/src/services/cron/pattern-extraction-cron.test.ts` | new | A4 |
| `packages/server/src/lib/feature-flags.ts` | +`isV2CronEnabled` | A5 |
| `packages/server/src/lib/feature-flags.test.ts` | +cron tests | A5 |
| `packages/server/src/services/proactive-scheduler.ts` | +cron hook in `tick()` | A5 |
| `packages/server/src/services/proactive-scheduler-v2-cron.test.ts` | new | A5 |
| `packages/server/scripts/migrate-to-v2.ts` | new | B1/B2 |
| `packages/server/src/scripts/migrate-to-v2.test.ts` | new (pure helpers) | B1/B2 |
| `packages/server/src/__integration__/v2-consolidation-flow.test.ts` | new | C1 |
| `packages/server/src/__integration__/v2-proactivity-flow.test.ts` | new | C2 |
| `packages/server/src/__integration__/v2-migration.test.ts` | new | C3 |
| `docs/plan/v2-memory-proactivity-scope.md` | progress flip | D1 |

**Hard constraints (verified per-task and in D1):**
- Zero `vi.mock` across `packages/server/src/`.
- One atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Conventional commits: `feat(v2-cron):` / `feat(v2-migration):` / `test(v2-integration):` / `docs(v2-progress):`.
- Migration in A1 is idempotent (`CREATE TABLE IF NOT EXISTS` + `DO $$` guards) mirroring `20260528000000_memory_pgvector_idempotent` + `20260529142404_v2_memory_schema`.
- No production-data writes during testing — migration script runs against local Docker postgres only; Railway prod migration is Berik's manual step.
- All Claude/DB calls in cron tasks wrapped in try/catch — `tick()` must never throw.
- Pure helpers exported separately from async methods so they are unit-testable without DB.
- Structural tests use `readFileSync` + grep (Week 3/4/5 pattern).

---

## Section A — Cron infrastructure (5 tasks)

The two cron tasks live under `services/cron/` to keep the existing `services/` directory uncluttered. Both share one idempotency primitive (`withCronLock`) backed by a single Prisma model (`CronJobRun`). The scheduler's existing `tick()` is the host: at the **top** of `tick()` (before the per-user loop) we add two `await runXIfDue()` calls, each wrapped in its own try/catch so a cron failure cannot break the user loop downstream. Pure helpers (`shouldRunCron`, `pickActiveUsers`) are exported separately and unit-tested without DB.

### Task A1: `CronJobRun` Prisma model + idempotent migration

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/<timestamp>_v2_cron_jobs/migration.sql`

The model is intentionally tiny — `jobName` + `userId?` + `ranAt` — because all we ever ask of it is "when did `jobName` last run for this user (or globally if userId is null)?". Two indexes: `(jobName, ranAt)` for the global case (mood-retention), `(userId, jobName, ranAt)` for the per-user case (future: per-user pattern extraction throttle). No FK on `userId` to `User.id` — when a user is deleted, the cron row can stay (it is just an audit row; the next pattern-extraction for that user simply never queries it).

- [ ] **Step 1: Edit `schema.prisma`**

Add at the end of the file (after the last `model BotIdentity { ... }` block, before any final whitespace):

```prisma
// v2.0 Week 6 (spec §9.6) — cron job audit log used for idempotency.
// Single tiny model shared by mood-retention-cron + pattern-extraction-cron.
// withCronLock(jobName, intervalMs, userId, fn) writes one row per successful
// run; "did this run recently?" = findFirst order by ranAt desc.
// No FK on userId — audit row stays even if user deleted (purely historical).
model CronJobRun {
  id      String   @id @default(cuid())
  jobName String
  userId  String?
  ranAt   DateTime @default(now())

  @@index([jobName, ranAt])
  @@index([userId, jobName, ranAt])
}
```

- [ ] **Step 2: Generate the migration SQL manually (we control the SQL, not `prisma migrate dev`, so it stays idempotent for prod)**

Compute timestamp: `date -u +%Y%m%d%H%M%S` (e.g. `20260531120000`). Create directory:

```bash
mkdir -p packages/server/prisma/migrations/20260531120000_v2_cron_jobs
```

Create `packages/server/prisma/migrations/20260531120000_v2_cron_jobs/migration.sql`:

```sql
-- v2.0 Week 6 — CronJobRun audit table for cron idempotency.
-- Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
-- Pattern: idempotent (IF NOT EXISTS + DO $$ guards), как в
-- 20260529142404_v2_memory_schema/migration.sql.
-- В проде no-op если уже накатили. В чистой dev — создаёт всё.

CREATE TABLE IF NOT EXISTS "CronJobRun" (
    "id"      TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "userId"  TEXT,
    "ranAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CronJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CronJobRun_jobName_ranAt_idx"
    ON "CronJobRun"("jobName", "ranAt");

CREATE INDEX IF NOT EXISTS "CronJobRun_userId_jobName_ranAt_idx"
    ON "CronJobRun"("userId", "jobName", "ranAt");
```

- [ ] **Step 3: Validate schema parses + Prisma client regenerates**

```bash
cd packages/server
npx prisma format
npx prisma generate
```

Expect: no errors, `CronJobRun` shows up in `node_modules/.prisma/client/index.d.ts`.

- [ ] **Step 4: Apply migration locally via Docker postgres (Week 2 pattern)**

```bash
cd packages/server
docker-compose -f docker-compose.dev.yml up -d
# Wait ~3s for postgres to be ready
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx prisma migrate deploy
```

Expect:
- Migration `20260531120000_v2_cron_jobs` applied.
- `psql -c '\d "CronJobRun"'` shows the table + 2 indexes.

If the dev DB is already on a newer state (drift), use `npx prisma migrate resolve --applied 20260531120000_v2_cron_jobs` instead.

- [ ] **Step 5: tsc — Prisma client types must compile**

```bash
cd packages/server
npx tsc --noEmit
```

Expect: 0 errors. `prisma.cronJobRun.findFirst` etc. must be type-safe.

- [ ] **Step 6: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/20260531120000_v2_cron_jobs/
git commit -m "$(cat <<'EOF'
feat(v2-cron): add CronJobRun model + idempotent migration (A1)

Single tiny audit table backing cron idempotency for the Week-6 cron
tasks (mood-retention daily + pattern-extraction weekly). jobName +
userId? + ranAt with two indexes; no FK on userId so audit rows
survive user deletion. Migration uses CREATE TABLE IF NOT EXISTS +
CREATE INDEX IF NOT EXISTS — same idempotent shape as the Week 2
v2_memory_schema and the pgvector migration. Safe to re-apply on prod.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: `cron-runner.ts` — pure `shouldRunCron` + `withCronLock` helpers

**Files:**
- Create: `packages/server/src/services/cron-runner.ts`
- Create: `packages/server/src/services/cron-runner.test.ts`

The pure helper `shouldRunCron(lastRanAt, intervalMs, now?)` is the heart of idempotency: true iff `lastRanAt` is `null` OR `now - lastRanAt >= intervalMs`. We deliberately tolerate clock skew (future `lastRanAt` → `false`, never `true`) so a momentary NTP correction can't cause a stampede. The async wrapper `withCronLock` (1) reads the last run, (2) decides via the pure helper, (3) executes the job, (4) records the run only on success — so a failed job retries next tick.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/cron-runner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldRunCron } from './cron-runner.js';

const SRC = readFileSync(join(__dirname, 'cron-runner.ts'), 'utf8');

describe('shouldRunCron — pure', () => {
  const now = new Date('2026-05-31T12:00:00Z');
  const oneHour = 60 * 60 * 1000;

  it('returns true when never ran (null lastRanAt)', () => {
    expect(shouldRunCron(null, oneHour, now)).toBe(true);
  });
  it('returns false when ran less than interval ago', () => {
    const lastRan = new Date(now.getTime() - oneHour / 2);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(false);
  });
  it('returns true exactly at interval boundary', () => {
    const lastRan = new Date(now.getTime() - oneHour);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(true);
  });
  it('returns true when ran much longer than interval ago', () => {
    const lastRan = new Date(now.getTime() - oneHour * 10);
    expect(shouldRunCron(lastRan, oneHour, now)).toBe(true);
  });
  it('returns false defensively on future lastRanAt (clock skew)', () => {
    const future = new Date(now.getTime() + oneHour);
    expect(shouldRunCron(future, oneHour, now)).toBe(false);
  });
  it('uses Date.now() default when called without now arg', () => {
    // Just verify it does not throw and returns a boolean.
    expect(typeof shouldRunCron(null, oneHour)).toBe('boolean');
  });
});

describe('structural — async wrappers', () => {
  it('exports lastRanAt querying prisma.cronJobRun.findFirst', () => {
    expect(SRC).toMatch(/export async function lastRanAt\(/);
    expect(SRC).toMatch(/prisma\.cronJobRun\.findFirst/);
    expect(SRC).toMatch(/orderBy:\s*\{\s*ranAt:\s*'desc'/);
  });
  it('exports recordRun calling prisma.cronJobRun.create', () => {
    expect(SRC).toMatch(/export async function recordRun\(/);
    expect(SRC).toMatch(/prisma\.cronJobRun\.create/);
  });
  it('exports withCronLock that records only on success', () => {
    expect(SRC).toMatch(/export async function withCronLock</);
    // recordRun is called inside try block AFTER fn(); on throw it must NOT be called.
    const body = SRC.slice(SRC.indexOf('withCronLock'));
    const fnCallIdx = body.indexOf('await fn(');
    const recordIdx = body.indexOf('recordRun(');
    expect(fnCallIdx).toBeGreaterThan(0);
    expect(recordIdx).toBeGreaterThan(fnCallIdx);
  });
  it('withCronLock returns { ran, result? } shape', () => {
    expect(SRC).toMatch(/ran:\s*true/);
    expect(SRC).toMatch(/ran:\s*false/);
  });
  it('withCronLock uses shouldRunCron for the gating decision', () => {
    expect(SRC).toMatch(/shouldRunCron\(\s*last/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/cron-runner.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `cron-runner.ts`**

Create `packages/server/src/services/cron-runner.ts`:

```typescript
/**
 * v2.0 Week 6 — cron idempotency primitive.
 *
 * Backs the two Week-6 cron tasks (mood-retention-cron, pattern-
 * extraction-cron). Single source of truth for "did this job run
 * recently?". Storage is the new CronJobRun Prisma model (Week 6 A1);
 * decision is the pure helper shouldRunCron.
 *
 * Semantics:
 *   - withCronLock(jobName, intervalMs, userId, fn) reads lastRanAt;
 *     if shouldRunCron → executes fn; on success records the run.
 *   - On fn throw → does NOT record → next scheduler tick retries.
 *   - Tolerates clock skew: future lastRanAt is treated as "ran very
 *     recently" (returns false) — never runs twice due to NTP jitter.
 *
 * userId === null = global job (e.g. mood-retention sweeps all users in
 * one pass). userId set = per-user job (future: per-user pattern
 * extraction with finer throttle).
 */

import { prisma } from '../lib/prisma.js';

export function shouldRunCron(
  lastRanAt: Date | null,
  intervalMs: number,
  now: Date = new Date(),
): boolean {
  if (lastRanAt === null) return true;
  const delta = now.getTime() - lastRanAt.getTime();
  // Defensive: future lastRanAt means clock went backwards (NTP correction,
  // VM time-warp, etc). Treat as "ran recently" — fail-closed.
  if (delta < 0) return false;
  return delta >= intervalMs;
}

export async function lastRanAt(
  jobName: string,
  userId: string | null = null,
): Promise<Date | null> {
  try {
    const row = await prisma.cronJobRun.findFirst({
      where: { jobName, userId: userId ?? null },
      orderBy: { ranAt: 'desc' },
      select: { ranAt: true },
    });
    return row?.ranAt ?? null;
  } catch (err) {
    console.warn(`[cron-runner] lastRanAt(${jobName}) failed:`, err);
    return null;
  }
}

export async function recordRun(
  jobName: string,
  userId: string | null = null,
): Promise<void> {
  try {
    await prisma.cronJobRun.create({
      data: { jobName, userId: userId ?? null },
    });
  } catch (err) {
    // Recording failure is non-fatal — worst case the job runs again
    // next tick. Log loudly so we notice if it becomes systematic.
    console.warn(`[cron-runner] recordRun(${jobName}) failed:`, err);
  }
}

export async function withCronLock<T>(
  jobName: string,
  intervalMs: number,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  const last = await lastRanAt(jobName, userId);
  if (!shouldRunCron(last, intervalMs)) {
    return { ran: false };
  }
  try {
    const result = await fn();
    // Record only on success — failures retry next tick automatically.
    await recordRun(jobName, userId);
    return { ran: true, result };
  } catch (err) {
    console.warn(`[cron-runner] withCronLock(${jobName}) fn threw:`, err);
    // Do NOT recordRun → next tick re-attempts.
    return { ran: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/cron-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/cron-runner.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/cron-runner.ts packages/server/src/services/cron-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-cron): cron-runner — pure shouldRunCron + withCronLock primitive (A2)

Single idempotency primitive shared by both Week-6 cron tasks. Pure
shouldRunCron tolerates clock skew (future lastRanAt → false). Async
withCronLock reads → decides → runs fn → records ONLY on success, so
failed jobs auto-retry next scheduler tick. Storage backed by the new
CronJobRun model (A1). Zero vi.mock; pure helper covered by 6 unit
tests, async wrappers covered by structural greps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: `mood-retention-cron.ts` — daily aggregate + 30-day delete

**Files:**
- Create: `packages/server/src/services/cron/mood-retention-cron.ts`
- Create: `packages/server/src/services/cron/mood-retention-cron.test.ts`

Per spec §9.6: every user's per-message `MoodSnapshot{source:'message'}` rows older than 30 days are aggregated **per-user per-day** into one `MoodSnapshot{source:'daily_agg'}` row, then the originals are deleted. Aggregation is `AVG(valence)`, `AVG(arousal)`, and `array_agg(DISTINCT unnest(entityRefs))` (deduped). This keeps timeline queries fast (one row/day instead of dozens) while preserving 30 days of high-resolution data for `detectMoodShift`. Whole function wrapped in try/catch with `[cron:mood-retention]` log prefix — never throws to the scheduler.

The cron extracts one pure helper: `groupSnapshotsByUserDay(rows)` — testable without DB, just transforms `[{userId,recordedAt,valence,arousal,entityRefs}...]` into `Map<string, { valence: number; arousal: number; entityRefs: string[]; count: number }>` keyed by `${userId}|${YYYY-MM-DD}`. The DB write loop then iterates the map.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/cron/mood-retention-cron.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  groupSnapshotsByUserDay,
  runMoodRetention,
} from './mood-retention-cron.js';

const SRC = readFileSync(join(__dirname, 'mood-retention-cron.ts'), 'utf8');

describe('groupSnapshotsByUserDay — pure', () => {
  it('groups by userId|YYYY-MM-DD with mean valence/arousal', () => {
    const rows = [
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.4,
        arousal: 0.2,
        entityRefs: ['e1'],
      },
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T18:00:00Z'),
        valence: 0.6,
        arousal: 0.4,
        entityRefs: ['e2', 'e1'],
      },
    ];
    const out = groupSnapshotsByUserDay(rows);
    expect(out.size).toBe(1);
    const v = out.get('u1|2026-04-01')!;
    expect(v.valence).toBeCloseTo(0.5);
    expect(v.arousal).toBeCloseTo(0.3);
    expect(new Set(v.entityRefs)).toEqual(new Set(['e1', 'e2']));
    expect(v.count).toBe(2);
  });
  it('separates users + days', () => {
    const rows = [
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
      {
        userId: 'u2',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-02T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
    ];
    expect(groupSnapshotsByUserDay(rows).size).toBe(3);
  });
  it('handles empty input', () => {
    expect(groupSnapshotsByUserDay([]).size).toBe(0);
  });
  it('handles null arousal (uses 0)', () => {
    const out = groupSnapshotsByUserDay([
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: null,
        entityRefs: [],
      },
    ]);
    expect(out.get('u1|2026-04-01')!.arousal).toBe(0);
  });
});

describe('structural — runMoodRetention', () => {
  it('uses 30-day cutoff', () => {
    expect(SRC).toMatch(/30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|RETENTION_DAYS\s*=\s*30/);
  });
  it('reads source: "message" snapshots older than cutoff', () => {
    expect(SRC).toMatch(/source:\s*['"]message['"]/);
    expect(SRC).toMatch(/recordedAt:\s*\{\s*lt:/);
  });
  it('writes back source: "daily_agg" rows', () => {
    expect(SRC).toMatch(/source:\s*['"]daily_agg['"]/);
  });
  it('deletes original per-message rows after aggregation', () => {
    expect(SRC).toMatch(/moodSnapshot\.deleteMany/);
  });
  it('wraps everything in try/catch with [cron:mood-retention] log prefix', () => {
    expect(SRC).toMatch(/\[cron:mood-retention\]/);
    expect(SRC).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]{0,300}?\[cron:mood-retention\]/);
  });
  it('never throws — outer catch returns void', () => {
    const body = SRC.slice(SRC.indexOf('export async function runMoodRetention'));
    expect(body).toMatch(/catch/);
    expect(body).not.toMatch(/throw\s+/);
  });
});

describe('runMoodRetention — runtime safety', () => {
  it('does not throw when DB is empty', async () => {
    await expect(runMoodRetention()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
mkdir -p src/services/cron
npm test -- --reporter=verbose src/services/cron/mood-retention-cron.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `mood-retention-cron.ts`**

Create `packages/server/src/services/cron/mood-retention-cron.ts`:

```typescript
/**
 * v2.0 Week 6 — daily mood-retention cron task.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
 *
 * Goal: keep MoodSnapshot table bounded. Per-message snapshots grow ~5-15
 * rows/day per active user; left unbounded the table is multi-GB in a
 * year. Retention = 30 days of high-res rows + indefinite daily aggregates.
 *
 * Pipeline:
 *   1. SELECT source='message' AND recordedAt < (now - 30d).
 *   2. Group by (userId, YYYY-MM-DD).
 *   3. INSERT one source='daily_agg' row per group with mean valence/arousal
 *      and deduped entityRefs union.
 *   4. DELETE the original rows.
 *
 * Best-effort: any error logs + returns; never throws to caller.
 * Fired weekly via withCronLock('mood-retention', 24h) — runs at most once
 * per 24h regardless of scheduler tick count (every 10 min).
 */

import { prisma } from '../../lib/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

type SnapshotRow = {
  userId: string;
  recordedAt: Date;
  valence: number;
  arousal: number | null;
  entityRefs: string[];
};

type Aggregate = {
  valence: number;
  arousal: number;
  entityRefs: string[];
  count: number;
};

/**
 * Pure helper — group rows by (userId, YYYY-MM-DD), averaging valence/arousal
 * and unioning entityRefs. Unit-tested without DB.
 */
export function groupSnapshotsByUserDay(
  rows: SnapshotRow[],
): Map<string, Aggregate> {
  const acc = new Map<
    string,
    {
      valenceSum: number;
      arousalSum: number;
      entityRefs: Set<string>;
      count: number;
    }
  >();
  for (const r of rows) {
    const day = r.recordedAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${r.userId}|${day}`;
    const existing = acc.get(key) ?? {
      valenceSum: 0,
      arousalSum: 0,
      entityRefs: new Set<string>(),
      count: 0,
    };
    existing.valenceSum += r.valence;
    existing.arousalSum += r.arousal ?? 0;
    for (const e of r.entityRefs) existing.entityRefs.add(e);
    existing.count += 1;
    acc.set(key, existing);
  }
  const out = new Map<string, Aggregate>();
  for (const [k, v] of acc) {
    out.set(k, {
      valence: v.valenceSum / v.count,
      arousal: v.arousalSum / v.count,
      entityRefs: Array.from(v.entityRefs),
      count: v.count,
    });
  }
  return out;
}

export async function runMoodRetention(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);

    const rows = (await prisma.moodSnapshot.findMany({
      where: { source: 'message', recordedAt: { lt: cutoff } },
      select: {
        userId: true,
        recordedAt: true,
        valence: true,
        arousal: true,
        entityRefs: true,
      },
    })) as SnapshotRow[];

    if (rows.length === 0) {
      console.log('[cron:mood-retention] no rows older than 30d — skipping');
      return;
    }

    const groups = groupSnapshotsByUserDay(rows);
    console.log(
      `[cron:mood-retention] aggregating ${rows.length} rows → ${groups.size} daily aggregates`,
    );

    // Insert aggregates one by one. We do NOT wrap in $transaction because a
    // single bad row should not roll back the whole sweep. Per-row try/catch
    // keeps the loop alive.
    let inserted = 0;
    for (const [key, agg] of groups) {
      const [userId, day] = key.split('|');
      try {
        await prisma.moodSnapshot.create({
          data: {
            userId,
            source: 'daily_agg',
            recordedAt: new Date(`${day}T12:00:00Z`),
            valence: agg.valence,
            arousal: agg.arousal,
            entityRefs: agg.entityRefs,
          },
        });
        inserted++;
      } catch (err) {
        console.warn(
          `[cron:mood-retention] insert aggregate failed key=${key}:`,
          err,
        );
      }
    }

    // Delete the originals only after at least one aggregate landed —
    // protects against catastrophic failure mode where we delete everything
    // without writing aggregates.
    if (inserted === 0) {
      console.warn(
        '[cron:mood-retention] zero aggregates inserted — skipping delete to preserve data',
      );
      return;
    }
    try {
      const deleted = await prisma.moodSnapshot.deleteMany({
        where: { source: 'message', recordedAt: { lt: cutoff } },
      });
      console.log(
        `[cron:mood-retention] done: ${inserted} aggregates, ${deleted.count} originals deleted`,
      );
    } catch (err) {
      console.warn('[cron:mood-retention] deleteMany failed:', err);
    }
  } catch (err) {
    console.warn('[cron:mood-retention] top-level failure:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/cron/mood-retention-cron.test.ts
```

Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/cron/mood-retention-cron.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/cron/mood-retention-cron.ts packages/server/src/services/cron/mood-retention-cron.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-cron): mood-retention daily cron task (A3)

Aggregates per-message MoodSnapshot rows older than 30 days into
per-user-per-day source='daily_agg' rows then deletes originals.
Pure helper groupSnapshotsByUserDay (4 unit tests) splits the
transform from the I/O. Best-effort throughout: per-aggregate
try/catch keeps the sweep alive; zero-insert guard prevents
catastrophic delete-without-aggregate; top-level catch with
[cron:mood-retention] prefix so failures never reach the scheduler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: `pattern-extraction-cron.ts` — weekly per-user extraction

**Files:**
- Create: `packages/server/src/services/cron/pattern-extraction-cron.ts`
- Create: `packages/server/src/services/cron/pattern-extraction-cron.test.ts`

Per spec §9.6: every Sunday(ish — we just run once per 7 days, not aligned to weekday) for every user who sent at least one `ChatMessage` in the last 7 days, call `getProceduralMemory().extractPatterns(userId)`. Sequential — per-user calls hit Claude (pattern extraction uses the LLM), so parallel would burn rate-limit budget. Per-user try/catch keeps the sweep alive when one user's extraction crashes. Pure helper `pickActiveUsers(allUsers, sinceDays?)` is extracted for unit testing — takes `[{ id, lastMessageAt }]` and a window, returns the subset.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/cron/pattern-extraction-cron.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickActiveUsers,
  runPatternExtraction,
} from './pattern-extraction-cron.js';

const SRC = readFileSync(
  join(__dirname, 'pattern-extraction-cron.ts'),
  'utf8',
);

describe('pickActiveUsers — pure', () => {
  const now = new Date('2026-05-31T12:00:00Z');
  it('includes users active within window', () => {
    const u = [
      { id: 'u1', lastMessageAt: new Date('2026-05-30T10:00:00Z') }, // 1d ago
      { id: 'u2', lastMessageAt: new Date('2026-05-25T10:00:00Z') }, // 6d ago
      { id: 'u3', lastMessageAt: new Date('2026-05-20T10:00:00Z') }, // 11d ago
    ];
    const out = pickActiveUsers(u, 7, now);
    expect(out.map((x) => x.id).sort()).toEqual(['u1', 'u2']);
  });
  it('excludes users with no recent messages', () => {
    const u = [{ id: 'u1', lastMessageAt: null }];
    expect(pickActiveUsers(u, 7, now)).toEqual([]);
  });
  it('default window = 7 days', () => {
    const u = [
      { id: 'u1', lastMessageAt: new Date('2026-05-28T10:00:00Z') }, // 3d
      { id: 'u2', lastMessageAt: new Date('2026-05-20T10:00:00Z') }, // 11d
    ];
    const out = pickActiveUsers(u, undefined, now);
    expect(out.map((x) => x.id)).toEqual(['u1']);
  });
  it('empty input → empty output', () => {
    expect(pickActiveUsers([], 7, now)).toEqual([]);
  });
});

describe('structural — runPatternExtraction', () => {
  it('queries User joined with last ChatMessage', () => {
    expect(SRC).toMatch(/chatMessage|ChatMessage/);
    expect(SRC).toMatch(/findMany/);
  });
  it('uses pickActiveUsers with 7-day window', () => {
    expect(SRC).toMatch(/pickActiveUsers\(/);
    expect(SRC).toMatch(/sinceDays:\s*7|,\s*7\s*[,)]/);
  });
  it('iterates SEQUENTIALLY (for...of, not Promise.all)', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+/);
    // No Promise.all of the per-user extraction (we explicitly want sequential
    // to respect Claude rate limit).
    expect(body).not.toMatch(/Promise\.all\(\s*\w+\.map/);
  });
  it('calls getProceduralMemory().extractPatterns per user', () => {
    expect(SRC).toMatch(/getProceduralMemory\(\)\.extractPatterns\(/);
  });
  it('wraps per-user call in its own try/catch', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).toMatch(/try\s*\{[\s\S]{0,400}?extractPatterns/);
    expect(body).toMatch(/\[cron:pattern-extraction\]/);
  });
  it('never throws — outer try/catch returns void', () => {
    const body = SRC.slice(
      SRC.indexOf('export async function runPatternExtraction'),
    );
    expect(body).not.toMatch(/^\s*throw\s+/m);
  });
});

describe('runPatternExtraction — runtime safety', () => {
  it('does not throw when no users / no messages', async () => {
    await expect(runPatternExtraction()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/cron/pattern-extraction-cron.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `pattern-extraction-cron.ts`**

Create `packages/server/src/services/cron/pattern-extraction-cron.ts`:

```typescript
/**
 * v2.0 Week 6 — weekly pattern-extraction cron task.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §9.6
 *
 * Goal: refresh procedural patterns (frequency, time-of-day, commitments,
 * streak-break) so the Week-5 proactivity engine has fresh detector input.
 *
 * Pipeline:
 *   1. SELECT every user with at least one ChatMessage in the last 7 days.
 *   2. For each (sequentially): getProceduralMemory().extractPatterns(userId).
 *
 * Sequential because extractPatterns hits Claude — parallel would burn the
 * rate limit. Per-user try/catch keeps the sweep alive when one user's
 * extraction crashes (bad Claude response, Voyage timeout, etc).
 *
 * Fired weekly via withCronLock('pattern-extraction', 7d).
 */

import { prisma } from '../../lib/prisma.js';
import { getProceduralMemory } from '../procedural-memory.singleton.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type UserWithLastMessage = {
  id: string;
  lastMessageAt: Date | null;
};

/**
 * Pure helper — filter users to those with at least one message in the last
 * `sinceDays` days. Unit-tested without DB.
 */
export function pickActiveUsers(
  users: UserWithLastMessage[],
  sinceDays = 7,
  now: Date = new Date(),
): UserWithLastMessage[] {
  const cutoff = now.getTime() - sinceDays * DAY_MS;
  return users.filter(
    (u) => u.lastMessageAt !== null && u.lastMessageAt.getTime() >= cutoff,
  );
}

export async function runPatternExtraction(): Promise<void> {
  try {
    // Join: every User + their most recent ChatMessage timestamp.
    // Prisma 6 doesn't have a clean "user with relation max" — we just
    // hand-roll the lookup. Two queries, both indexed.
    const users = await prisma.user.findMany({ select: { id: true } });
    if (users.length === 0) {
      console.log('[cron:pattern-extraction] no users — skipping');
      return;
    }

    const userIds = users.map((u) => u.id);
    const lastMessages = await prisma.chatMessage.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true },
    });
    const lastByUser = new Map<string, Date | null>();
    for (const u of userIds) lastByUser.set(u, null);
    for (const m of lastMessages) {
      lastByUser.set(m.userId, m._max.createdAt ?? null);
    }

    const enriched: UserWithLastMessage[] = users.map((u) => ({
      id: u.id,
      lastMessageAt: lastByUser.get(u.id) ?? null,
    }));

    const active = pickActiveUsers(enriched, 7);
    if (active.length === 0) {
      console.log(
        '[cron:pattern-extraction] no users active in last 7d — skipping',
      );
      return;
    }

    console.log(
      `[cron:pattern-extraction] starting sweep for ${active.length} active users`,
    );

    const procedural = getProceduralMemory();
    let ok = 0;
    let failed = 0;
    for (const u of active) {
      try {
        const patterns = await procedural.extractPatterns(u.id);
        ok++;
        console.log(
          `[cron:pattern-extraction] user=${u.id} → ${patterns.length} patterns`,
        );
      } catch (err) {
        failed++;
        console.warn(
          `[cron:pattern-extraction] user=${u.id} extractPatterns failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `[cron:pattern-extraction] done: ${ok} ok, ${failed} failed, ${active.length} total`,
    );
  } catch (err) {
    console.warn('[cron:pattern-extraction] top-level failure:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/services/cron/pattern-extraction-cron.test.ts
```

Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/cron/pattern-extraction-cron.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/cron/pattern-extraction-cron.ts packages/server/src/services/cron/pattern-extraction-cron.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-cron): pattern-extraction weekly cron task (A4)

Fires getProceduralMemory().extractPatterns sequentially for each user
active in the last 7 days. Sequential by design — extractPatterns hits
Claude; parallel would burn the rate limit. Per-user try/catch keeps
the sweep alive when one user's extraction crashes. Pure helper
pickActiveUsers (4 unit tests) splits the windowing decision from the
I/O. Logs ok/failed/total counts so failures are observable in
Railway logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Wire both crons into `proactive-scheduler.ts` tick() + `isV2CronEnabled` flag

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/lib/feature-flags.test.ts`
- Modify: `packages/server/src/services/proactive-scheduler.ts`
- Create: `packages/server/src/services/proactive-scheduler-v2-cron.test.ts`

The hook lives at the **top** of `tick()` — before the per-user loop — for two reasons: (1) cron sweeps that affect global state (mood-retention) should land before the engine reads from those tables on the same tick; (2) symmetrically, fresh pattern extraction lands before the engine reads patterns. Each hook is its own try/catch so a cron failure cannot break the user loop.

The new flag `isV2CronEnabled()` is global (no `userId` arg) because crons are global jobs, not per-user. Env value: `FEATURE_V2_CRON=true` / `all` enables; anything else (`unset`/`false`/`none`) disables. Reuses the same parsing approach as the existing `isEnabledForUser` for the boolean-only case.

- [ ] **Step 1: Write failing tests for flag**

Edit `packages/server/src/lib/feature-flags.test.ts` — append:

```typescript
import {
  isV2MemoryEnabled,
  isV2ProactivityEnabled,
  isV2CronEnabled,
} from './feature-flags.js';

describe('isV2CronEnabled — global flag (no userId arg)', () => {
  const ORIG = process.env.FEATURE_V2_CRON;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_CRON;
    else process.env.FEATURE_V2_CRON = ORIG;
  });
  it('unset → false', () => {
    delete process.env.FEATURE_V2_CRON;
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"none" → false', () => {
    process.env.FEATURE_V2_CRON = 'none';
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"false" → false', () => {
    process.env.FEATURE_V2_CRON = 'false';
    expect(isV2CronEnabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.FEATURE_V2_CRON = 'true';
    expect(isV2CronEnabled()).toBe(true);
  });
  it('"all" → true (alias for true)', () => {
    process.env.FEATURE_V2_CRON = 'all';
    expect(isV2CronEnabled()).toBe(true);
  });
  it('"  true  " → true (whitespace tolerant)', () => {
    process.env.FEATURE_V2_CRON = '  true  ';
    expect(isV2CronEnabled()).toBe(true);
  });
});
```

(If `afterEach` is not yet imported in that file, add it to the existing `import { describe, it, expect, afterEach } from 'vitest'` line.)

- [ ] **Step 2: Run test to verify flag tests fail**

```bash
cd packages/server
npm test -- src/lib/feature-flags.test.ts
```

Expected: FAIL — `isV2CronEnabled` not exported.

- [ ] **Step 3: Edit `feature-flags.ts` — add `isV2CronEnabled`**

Append to `packages/server/src/lib/feature-flags.ts`:

```typescript
/**
 * v2.0 Week 6 — global cron flag.
 *
 * Crons are global jobs (one sweep affects all users), so no per-user
 * tagging. Enable on Railway with FEATURE_V2_CRON=true once the v2
 * memory dual-write has been running for at least a few days (Week 7
 * after Berik SMOKE passes).
 */
export function isV2CronEnabled(): boolean {
  const flag = (process.env.FEATURE_V2_CRON ?? '').trim();
  if (!flag || flag === 'none' || flag === 'false') return false;
  return flag === 'true' || flag === 'all';
}
```

- [ ] **Step 4: Re-run flag tests — should pass**

```bash
cd packages/server
npm test -- src/lib/feature-flags.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing scheduler wiring test**

Create `packages/server/src/services/proactive-scheduler-v2-cron.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'proactive-scheduler.ts'), 'utf8');

describe('proactive-scheduler — v2 cron wiring (A5)', () => {
  it('imports isV2CronEnabled', () => {
    expect(SRC).toMatch(/isV2CronEnabled/);
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
  });
  it('imports both cron tasks', () => {
    expect(SRC).toMatch(/from '\.\/cron\/mood-retention-cron\.js'/);
    expect(SRC).toMatch(/from '\.\/cron\/pattern-extraction-cron\.js'/);
    expect(SRC).toMatch(/runMoodRetention/);
    expect(SRC).toMatch(/runPatternExtraction/);
  });
  it('imports withCronLock from cron-runner', () => {
    expect(SRC).toMatch(/from '\.\/cron-runner\.js'/);
    expect(SRC).toMatch(/withCronLock/);
  });
  it('hooks run BEFORE the per-user loop', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    const moodIdx = tickFn.indexOf('runMoodRetention');
    const patternIdx = tickFn.indexOf('runPatternExtraction');
    const loopIdx = tickFn.indexOf('for (const { id: userId }');
    expect(moodIdx).toBeGreaterThan(0);
    expect(patternIdx).toBeGreaterThan(0);
    expect(loopIdx).toBeGreaterThan(0);
    expect(moodIdx).toBeLessThan(loopIdx);
    expect(patternIdx).toBeLessThan(loopIdx);
  });
  it('both hooks are gated by isV2CronEnabled()', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    // Two flag checks before the loop
    const beforeLoop = tickFn.slice(0, tickFn.indexOf('for (const { id: userId }'));
    const flagChecks = beforeLoop.match(/isV2CronEnabled\(\s*\)/g) ?? [];
    expect(flagChecks.length).toBeGreaterThanOrEqual(1);
  });
  it('mood-retention uses 24h interval, pattern-extraction uses 7d', () => {
    expect(SRC).toMatch(/withCronLock\(\s*['"]mood-retention['"]\s*,\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(SRC).toMatch(/withCronLock\(\s*['"]pattern-extraction['"]\s*,\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
  it('each hook in its own try/catch with cron prefix log', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,150}?\[cron:/);
  });
});
```

- [ ] **Step 6: Run test to verify wiring tests fail**

```bash
cd packages/server
npm test -- src/services/proactive-scheduler-v2-cron.test.ts
```

Expected: FAIL — cron hook not yet present.

- [ ] **Step 7: Edit `proactive-scheduler.ts`**

Add imports near the top (next to the existing `isV2ProactivityEnabled` import):

```typescript
import { isV2CronEnabled } from '../lib/feature-flags.js';
import { withCronLock } from './cron-runner.js';
import { runMoodRetention } from './cron/mood-retention-cron.js';
import { runPatternExtraction } from './cron/pattern-extraction-cron.js';
```

Inside `async function tick()`, **before** the `for (const { id: userId } of users)` loop at line ~92, insert:

```typescript
    // v2.0 Week 6 A5 — global cron hooks (mood-retention daily,
    // pattern-extraction weekly). Run BEFORE the per-user loop so that:
    //   - mood-retention's aggregate writes land before the proactivity
    //     engine reads MoodSnapshot in the loop below;
    //   - pattern-extraction's fresh patterns are visible to detectors
    //     on the same tick.
    // Both behind isV2CronEnabled (global); withCronLock enforces the
    // 24h / 7d interval regardless of how often tick fires. Each hook
    // is its own try/catch — a cron failure must not break the user loop.
    if (isV2CronEnabled()) {
      try {
        const r = await withCronLock(
          'mood-retention',
          24 * 60 * 60 * 1000,
          null,
          runMoodRetention,
        );
        if (r.ran) console.log('[cron:mood-retention] tick: ran');
      } catch (err) {
        console.warn(
          '[cron:mood-retention] tick hook failed:',
          err instanceof Error ? err.message : err,
        );
      }
      try {
        const r = await withCronLock(
          'pattern-extraction',
          7 * 24 * 60 * 60 * 1000,
          null,
          runPatternExtraction,
        );
        if (r.ran) console.log('[cron:pattern-extraction] tick: ran');
      } catch (err) {
        console.warn(
          '[cron:pattern-extraction] tick hook failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
```

- [ ] **Step 8: Run test to verify wiring tests pass**

```bash
cd packages/server
npm test -- src/services/proactive-scheduler-v2-cron.test.ts
npm test -- src/services/proactive-scheduler-v2.test.ts
```

Expected: PASS for both (Week 5 wiring test still green).

- [ ] **Step 9: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/proactive-scheduler-v2-cron.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts packages/server/src/services/proactive-scheduler.ts packages/server/src/services/proactive-scheduler-v2-cron.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-cron): wire mood-retention + pattern-extraction into scheduler tick (A5)

Both crons fire at the top of tick() — before the per-user loop — so
aggregated mood data and freshly extracted patterns are visible to the
proactivity engine on the same tick. withCronLock enforces 24h /
7d intervals across restarts (DB-backed via CronJobRun). Behind a new
global isV2CronEnabled (FEATURE_V2_CRON=true to enable). Each hook is
its own try/catch — a cron failure must never break the user loop or
the scheduler interval.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section B — Migration script (2 tasks)

The migration script is a one-shot, single-user, two-mode CLI (`--dry-run` / `--apply`). Dry-run reports every intended write to stdout without touching the DB; apply performs the writes inside per-step try/catch (no atomic `$transaction` — Berik's corpus is ~67 rows, a partial migration is recoverable). B1 lays down the skeleton + CLI; B2 fills the migration logic.

### Task B1: `migrate-to-v2.ts` skeleton + CLI parser

**Files:**
- Create: `packages/server/scripts/migrate-to-v2.ts`
- Create: `packages/server/src/scripts/migrate-to-v2.test.ts`

The pure helper `parseCliArgs(argv: string[])` returns `{ userId: string; mode: 'dry-run' | 'apply' } | { error: string }`. Validation: both `--user=<id>` and exactly one of `--dry-run` / `--apply` required.

Note: the test file lives under `src/scripts/` (not `scripts/`) so that vitest picks it up — vitest's default include is `src/**/*.test.ts`. We re-export the pure helper from `scripts/migrate-to-v2.ts` and import it into the test file via a relative path.

- [ ] **Step 1: Write failing test for CLI parser**

Create `packages/server/src/scripts/migrate-to-v2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Note: script lives in packages/server/scripts/, not packages/server/src/.
// Resolve relative to this test file.
import { parseCliArgs } from '../../scripts/migrate-to-v2.js';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'migrate-to-v2.ts');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('parseCliArgs — pure', () => {
  it('accepts --user=X --dry-run', () => {
    const out = parseCliArgs(['--user=abc123', '--dry-run']);
    expect(out).toEqual({ userId: 'abc123', mode: 'dry-run' });
  });
  it('accepts --user=X --apply', () => {
    const out = parseCliArgs(['--user=abc123', '--apply']);
    expect(out).toEqual({ userId: 'abc123', mode: 'apply' });
  });
  it('order-independent', () => {
    expect(parseCliArgs(['--dry-run', '--user=xyz'])).toEqual({
      userId: 'xyz',
      mode: 'dry-run',
    });
  });
  it('rejects missing --user', () => {
    const out = parseCliArgs(['--dry-run']);
    expect('error' in out).toBe(true);
  });
  it('rejects missing mode', () => {
    const out = parseCliArgs(['--user=abc']);
    expect('error' in out).toBe(true);
  });
  it('rejects both modes', () => {
    const out = parseCliArgs(['--user=abc', '--dry-run', '--apply']);
    expect('error' in out).toBe(true);
  });
  it('rejects empty user', () => {
    const out = parseCliArgs(['--user=', '--apply']);
    expect('error' in out).toBe(true);
  });
  it('ignores unknown args (defensive)', () => {
    const out = parseCliArgs(['--user=abc', '--dry-run', '--verbose']);
    expect(out).toEqual({ userId: 'abc', mode: 'dry-run' });
  });
});

describe('structural — skeleton', () => {
  it('exports parseCliArgs', () => {
    expect(SRC).toMatch(/export function parseCliArgs\(/);
  });
  it('has a main() entrypoint', () => {
    expect(SRC).toMatch(/async function main\(\s*\)/);
  });
  it('uses process.argv', () => {
    expect(SRC).toMatch(/process\.argv/);
  });
  it('imports PrismaClient', () => {
    expect(SRC).toMatch(/PrismaClient/);
  });
  it('top-level catch + prisma.$disconnect in finally', () => {
    expect(SRC).toMatch(/\$disconnect/);
    expect(SRC).toMatch(/\.catch\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server
mkdir -p src/scripts
npm test -- --reporter=verbose src/scripts/migrate-to-v2.test.ts
```

Expected: FAIL — script file missing.

- [ ] **Step 3: Implement skeleton + parser**

Create `packages/server/scripts/migrate-to-v2.ts`:

```typescript
/**
 * v2.0 Week 6 — manual migration script. Single-user scope.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §11
 *
 * Usage:
 *   # Preview only — NO writes:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run
 *
 *   # Apply:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply
 *
 * What it does (--apply):
 *   1. Backfill Memory.validAt = createdAt for rows where validAt IS NULL.
 *   2. Lift legacy Memory rows into the Entity graph (person/place/decision).
 *   3. Upsert BotIdentity with defaults if not exists.
 *   4. Run getProceduralMemory().extractPatterns(userId) once at end.
 *
 * No $transaction wrapping — Berik's corpus is small (~67 rows). A
 * partial migration is recoverable (re-run is idempotent: validAt
 * backfill is UPDATE WHERE NULL; entity upsert is unique-key based;
 * BotIdentity upsert is by userId).
 *
 * Safety: --apply requires explicit flag; default to printing help.
 * Tests in src/scripts/migrate-to-v2.test.ts (pure parser only — full
 * migration covered by C3 integration test against local Docker DB).
 */

import { PrismaClient } from '@prisma/client';

// ---- Pure CLI parser ------------------------------------------------------

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
      if (val.length === 0) {
        return { error: '--user=<id> requires a non-empty value' };
      }
      userId = val;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--apply') {
      apply = true;
    }
    // Unknown args are ignored (defensive).
  }
  if (!userId) {
    return {
      error: 'Missing --user=<id>. Usage: --user=<id> --dry-run | --apply',
    };
  }
  if (dryRun && apply) {
    return { error: '--dry-run and --apply are mutually exclusive' };
  }
  if (!dryRun && !apply) {
    return { error: 'Pick a mode: --dry-run or --apply' };
  }
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

// ---- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('migrate-to-v2:', parsed.error);
    console.error(
      'Usage:\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply',
    );
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();

  console.log(`[migrate-to-v2] user=${userId} mode=${mode}`);

  try {
    // B2 fills in the real migration logic. B1 only prints what WOULD run.
    console.log('[migrate-to-v2] (B1 skeleton) — no work performed.');
    console.log(
      '[migrate-to-v2] Run after B2 lands for the full migration logic.',
    );
  } catch (err) {
    console.error('[migrate-to-v2] failed:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run as entrypoint, not when imported by tests.
if (process.argv[1]?.endsWith('migrate-to-v2.ts') ||
    process.argv[1]?.endsWith('migrate-to-v2.js')) {
  main().catch((e) => {
    console.error('migrate-to-v2 fatal:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server
npm test -- --reporter=verbose src/scripts/migrate-to-v2.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test the CLI invocation locally**

```bash
cd packages/server
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx tsx scripts/migrate-to-v2.ts --user=nonexistent --dry-run
```

Expected: prints `[migrate-to-v2] user=nonexistent mode=dry-run` + the B1 skeleton notice. Exit code 0.

```bash
npx tsx scripts/migrate-to-v2.ts
```

Expected: usage error, exit 1.

- [ ] **Step 6: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/scripts/migrate-to-v2.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/scripts/migrate-to-v2.ts packages/server/src/scripts/migrate-to-v2.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-migration): migrate-to-v2 skeleton + CLI parser (B1)

Single-user manual migration script with two modes (--dry-run /
--apply). B1 lays down the skeleton + pure parseCliArgs (8 unit
tests). B2 fills the migration logic. Refuses to run without an
explicit mode flag — no accidental writes. Idempotent by design: all
real migration steps in B2 use UPSERT or WHERE NULL guards so re-runs
are safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Full migration logic — validAt backfill + Entity lift + BotIdentity + extractPatterns

**Files:**
- Modify: `packages/server/scripts/migrate-to-v2.ts`
- Modify: `packages/server/src/scripts/migrate-to-v2.test.ts`

Per spec §11, the migration has four steps:

1. **`Memory.validAt` backfill** — raw SQL `UPDATE "Memory" SET "validAt" = "createdAt" WHERE "userId" = $1 AND "validAt" IS NULL`. The Week 2 migration already added the column with `DEFAULT CURRENT_TIMESTAMP`, but pre-Week-2 rows (rows older than the migration) may have their `validAt` set to the migration's `CURRENT_TIMESTAMP` rather than their original `createdAt`. This step fixes that.

2. **Entity lift** — `SELECT * FROM "Memory" WHERE "userId" = $1`. For each row, map by `type`:
   - `type='person'` → `entityGraph.upsertEntity(userId, { type: 'person', name: content, importance })`
   - `type='place'` → `{ type: 'place', name: content, importance }`
   - `type='decision'` → `{ type: 'goal', name: content, importance }` (per spec §11 mapping)
   - `type='ritual'`, `type='task'`, etc. → skip (those stay in their existing tables)
   - Unknown types → skip with warning.

3. **`BotIdentity` upsert** — `prisma.botIdentity.upsert({ where: { userId }, create: { userId, botName: 'Эля', style: 'warm' }, update: {} })`. No-op when identity already exists.

4. **Run `getProceduralMemory().extractPatterns(userId)`** once at the end. Allows the first proactivity tick after migration to have something to read.

Dry-run mode: every step logs `[dry-run]` prefix and the intended write parameters; no DB writes. Apply mode: each step in its own try/catch; partial failures don't abort the rest. Report at end: `{ memoriesBackfilled, entitiesCreated, identityCreated, patternsExtracted }`.

- [ ] **Step 1: Append failing structural tests**

Append to `packages/server/src/scripts/migrate-to-v2.test.ts`:

```typescript
describe('structural — B2 migration logic', () => {
  const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'migrate-to-v2.ts');
  const SRC = readFileSync(SCRIPT_PATH, 'utf8');

  it('imports getEntityGraph + getProceduralMemory', () => {
    expect(SRC).toMatch(/getEntityGraph/);
    expect(SRC).toMatch(/getProceduralMemory/);
  });

  it('step 1: backfill Memory.validAt via raw SQL', () => {
    expect(SRC).toMatch(/UPDATE\s+"Memory"\s+SET\s+"validAt"\s*=\s*"createdAt"/i);
    expect(SRC).toMatch(/WHERE[\s\S]{0,80}?"validAt"\s+IS\s+NULL/i);
  });

  it('step 2: reads Memory rows for user and maps type → entity', () => {
    expect(SRC).toMatch(/memory\.findMany/);
    expect(SRC).toMatch(/upsertEntity/);
    expect(SRC).toMatch(/'person'/);
    expect(SRC).toMatch(/'place'/);
    // decision → goal mapping per spec §11
    expect(SRC).toMatch(/'decision'/);
    expect(SRC).toMatch(/'goal'/);
  });

  it('step 3: upsert BotIdentity with defaults', () => {
    expect(SRC).toMatch(/botIdentity\.upsert/);
    expect(SRC).toMatch(/['"]Эля['"]/);
  });

  it('step 4: calls extractPatterns at the end', () => {
    expect(SRC).toMatch(/extractPatterns\(\s*userId\s*\)/);
  });

  it('dry-run mode logs [dry-run] prefix and performs no writes', () => {
    expect(SRC).toMatch(/\[dry-run\]/);
    // All write calls must be inside `if (mode === 'apply')` or similar guards.
    expect(SRC).toMatch(/mode\s*===\s*['"]apply['"]/);
  });

  it('per-step try/catch (no $transaction wrapping the whole thing)', () => {
    // Sentinel: at least 4 try blocks (one per step).
    const tryCount = (SRC.match(/\btry\s*\{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(4);
    expect(SRC).not.toMatch(/\$transaction\(/);
  });

  it('end-of-run report with counts', () => {
    expect(SRC).toMatch(/memoriesBackfilled|entitiesCreated|identityCreated|patternsExtracted/);
  });
});
```

- [ ] **Step 2: Run test to verify B2 tests fail**

```bash
cd packages/server
npm test -- src/scripts/migrate-to-v2.test.ts
```

Expected: FAIL — B2 logic not implemented.

- [ ] **Step 3: Implement the full migration logic**

Replace the body of `main()` in `packages/server/scripts/migrate-to-v2.ts` so the file becomes:

```typescript
/**
 * v2.0 Week 6 — manual migration script. Single-user scope.
 *
 * Spec: docs/superpowers/specs/2026-05-28-v2-memory-proactivity-design.md §11
 *
 * Usage:
 *   # Preview only — NO writes:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run
 *
 *   # Apply:
 *   npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply
 *
 * What it does (--apply):
 *   1. Backfill Memory.validAt = createdAt where NULL.
 *   2. Lift Memory rows into Entity graph (person/place/decision→goal).
 *   3. Upsert BotIdentity with defaults if not exists.
 *   4. Run getProceduralMemory().extractPatterns(userId) once at end.
 *
 * Idempotent — re-run safe. Per-step try/catch; partial failure doesn't
 * abort the rest. No $transaction (corpus is small, recoverable).
 */

import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from '../src/services/entity-graph/index.js';
import { getProceduralMemory } from '../src/services/procedural-memory.singleton.js';

// ---- Pure CLI parser ------------------------------------------------------

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
      if (val.length === 0) {
        return { error: '--user=<id> requires a non-empty value' };
      }
      userId = val;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--apply') {
      apply = true;
    }
  }
  if (!userId) {
    return {
      error: 'Missing --user=<id>. Usage: --user=<id> --dry-run | --apply',
    };
  }
  if (dryRun && apply) {
    return { error: '--dry-run and --apply are mutually exclusive' };
  }
  if (!dryRun && !apply) {
    return { error: 'Pick a mode: --dry-run or --apply' };
  }
  return { userId, mode: dryRun ? 'dry-run' : 'apply' };
}

// ---- Type → entity-type mapping per spec §11 -----------------------------

type MemoryRow = {
  id: string;
  type: string;
  content: string;
  importance: number;
};

function mapMemoryToEntity(
  m: MemoryRow,
): { type: 'person' | 'place' | 'goal'; name: string; importance: number } | null {
  switch (m.type) {
    case 'person':
      return { type: 'person', name: m.content, importance: m.importance };
    case 'place':
      return { type: 'place', name: m.content, importance: m.importance };
    case 'decision':
      // Spec §11: decision → goal (long-form intent that needs goal tracking).
      return { type: 'goal', name: m.content, importance: m.importance };
    default:
      return null;
  }
}

// ---- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error('migrate-to-v2:', parsed.error);
    console.error(
      'Usage:\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --dry-run\n' +
        '  npx tsx packages/server/scripts/migrate-to-v2.ts --user=<id> --apply',
    );
    process.exit(1);
  }

  const { userId, mode } = parsed;
  const prisma = new PrismaClient();

  console.log(`[migrate-to-v2] user=${userId} mode=${mode}`);
  const dry = mode === 'dry-run';
  const tag = dry ? '[dry-run]' : '[apply]';

  let memoriesBackfilled = 0;
  let entitiesCreated = 0;
  let entitiesSkipped = 0;
  let identityCreated = false;
  let patternsExtracted = 0;

  // ---- Step 1: validAt backfill ------------------------------------------
  try {
    const candidates = await prisma.memory.count({
      where: { userId, validAt: null as unknown as Date },
    });
    console.log(`${tag} step 1: ${candidates} Memory rows with NULL validAt`);
    if (!dry && candidates > 0) {
      // Raw SQL — Prisma cannot express "SET validAt = createdAt" cleanly.
      const result = await prisma.$executeRaw`
        UPDATE "Memory"
           SET "validAt" = "createdAt"
         WHERE "userId" = ${userId}
           AND "validAt" IS NULL
      `;
      memoriesBackfilled = Number(result);
      console.log(`${tag} step 1: backfilled ${memoriesBackfilled} rows`);
    }
  } catch (err) {
    console.warn(`${tag} step 1 failed:`, err);
  }

  // ---- Step 2: Memory → Entity lift --------------------------------------
  try {
    const rows = (await prisma.memory.findMany({
      where: { userId },
      select: { id: true, type: true, content: true, importance: true },
    })) as MemoryRow[];
    console.log(`${tag} step 2: scanning ${rows.length} Memory rows`);
    const graph = getEntityGraph();
    for (const m of rows) {
      const mapped = mapMemoryToEntity(m);
      if (!mapped) {
        entitiesSkipped++;
        continue;
      }
      try {
        if (dry) {
          console.log(
            `${tag} step 2: would upsert entity type=${mapped.type} name=${JSON.stringify(mapped.name)} importance=${mapped.importance}`,
          );
        } else {
          await graph.upsertEntity(userId, {
            type: mapped.type,
            name: mapped.name,
            importance: mapped.importance,
            attributes: {},
          });
          entitiesCreated++;
        }
      } catch (err) {
        console.warn(
          `${tag} step 2: upsert failed for memory.id=${m.id}:`,
          err,
        );
      }
    }
    console.log(
      `${tag} step 2: ${entitiesCreated} upserted, ${entitiesSkipped} skipped (unmapped type)`,
    );
  } catch (err) {
    console.warn(`${tag} step 2 failed:`, err);
  }

  // ---- Step 3: BotIdentity upsert ----------------------------------------
  try {
    const existing = await prisma.botIdentity.findUnique({ where: { userId } });
    if (existing) {
      console.log(`${tag} step 3: BotIdentity exists (botName=${existing.botName}) — no change`);
    } else if (dry) {
      console.log(`${tag} step 3: would create BotIdentity { botName: 'Эля', style: 'warm' }`);
    } else {
      await prisma.botIdentity.create({
        data: { userId, botName: 'Эля', style: 'warm' },
      });
      identityCreated = true;
      console.log(`${tag} step 3: BotIdentity created`);
    }
  } catch (err) {
    console.warn(`${tag} step 3 failed:`, err);
  }

  // ---- Step 4: extractPatterns -------------------------------------------
  try {
    if (dry) {
      console.log(`${tag} step 4: would call extractPatterns(${userId})`);
    } else {
      const patterns = await getProceduralMemory().extractPatterns(userId);
      patternsExtracted = patterns.length;
      console.log(`${tag} step 4: extracted ${patternsExtracted} patterns`);
    }
  } catch (err) {
    console.warn(`${tag} step 4 failed:`, err);
  }

  // ---- Report ------------------------------------------------------------
  console.log('');
  console.log('=== migrate-to-v2 summary ===');
  console.log(`user:                ${userId}`);
  console.log(`mode:                ${mode}`);
  console.log(`memoriesBackfilled:  ${memoriesBackfilled}`);
  console.log(`entitiesCreated:     ${entitiesCreated}`);
  console.log(`entitiesSkipped:     ${entitiesSkipped}`);
  console.log(`identityCreated:     ${identityCreated}`);
  console.log(`patternsExtracted:   ${patternsExtracted}`);

  await prisma.$disconnect();
}

if (
  process.argv[1]?.endsWith('migrate-to-v2.ts') ||
  process.argv[1]?.endsWith('migrate-to-v2.js')
) {
  main().catch((e) => {
    console.error('migrate-to-v2 fatal:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify B2 tests pass**

```bash
cd packages/server
npm test -- src/scripts/migrate-to-v2.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test dry-run against local Docker DB**

```bash
cd packages/server
# Use a real userId from the local DB; if none, create one first via prisma studio or list-users.mjs.
USER=$(DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  node list-users.mjs | tail -n 1 | awk '{print $1}')
echo "Using userId=$USER"
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx tsx scripts/migrate-to-v2.ts --user="$USER" --dry-run
```

Expected: prints `[dry-run] step 1...4` plus a summary. No errors. DB row count unchanged:

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d lifeos_dev -c \
  'SELECT count(*) FROM "Entity" WHERE "userId" = '"'"$USER"'"';'
```

- [ ] **Step 6: Smoke-test apply against local Docker DB**

```bash
cd packages/server
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx tsx scripts/migrate-to-v2.ts --user="$USER" --apply
```

Expected: `[apply]` log lines + summary with non-zero counts (assuming the user has any Memory rows). Re-run to confirm idempotency:

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx tsx scripts/migrate-to-v2.ts --user="$USER" --apply
```

Second run: `entitiesCreated` may stay the same (upsert returns existing); `memoriesBackfilled = 0` (all already filled); `identityCreated = false`.

- [ ] **Step 7: Full suite + tsc + vi.mock guard**

```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/scripts/migrate-to-v2.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 8: Commit**

```bash
git add packages/server/scripts/migrate-to-v2.ts packages/server/src/scripts/migrate-to-v2.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-migration): migrate-to-v2 full logic — validAt + Entity lift + BotIdentity + extractPatterns (B2)

Four steps per spec §11. Step 1 backfills Memory.validAt via raw SQL
WHERE NULL guard. Step 2 lifts Memory rows into Entity graph with the
person/place/decision→goal mapping; per-row try/catch + skip on
unknown type. Step 3 upserts BotIdentity with default «Эля» + 'warm'
style (no-op when present). Step 4 fires extractPatterns once so the
first proactivity tick has data. Dry-run prints every intended write
without touching the DB; apply uses per-step try/catch (no
$transaction — small corpus, recoverable). Idempotent re-run safe.
Local Docker smoke-tested both modes including double-apply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section C — Integration tests (3 tasks)

Three structural integration tests live under `packages/server/src/__integration__/` to flag them as integration-tier (still vitest-discovered via `src/**/*.test.ts` glob, just bucketed for clarity). Each is a `readFileSync` + grep test verifying the cross-module wiring is present and correctly ordered — not an E2E test against a real DB + Claude. This matches Berik's scope decision: integration here means "the wires are connected" not "the box turns on". E2E lives in F1 SMOKE for Week 5 (Berik runs by hand) and similar for Week 7.

### Task C1: `v2-consolidation-flow.test.ts` — inbound capture wiring

**Files:**
- Create: `packages/server/src/__integration__/v2-consolidation-flow.test.ts`

The "consolidation flow" is the inbound path: a Telegram message lands in `jarvis-orchestrator.handleMessage` → triggers `captureInBackground` → fires `captureV2InBackground` (Week 5 D3 hook) → that helper extracts entities, upserts into Entity, records an episodic event, and analyzes mood. This test asserts that **all** of these calls are wired (the Week 5 task `jarvis-orchestrator-v2.test.ts` covers the orchestrator end; this test covers the full call chain on the captureV2 side).

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/__integration__/v2-consolidation-flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C1 — Integration test for the inbound consolidation flow.
 *
 * Verifies the full call chain from message arrival to memory-tier write
 * is wired correctly. Structural (not E2E): each link in the chain
 * imports + calls the next. E2E coverage is via F1 SMOKE (Berik runs
 * manually on Railway in Week 7).
 *
 * Chain (per spec §8.1):
 *   handleMessage
 *     → captureInBackground (legacy + v2 dual-write under flag)
 *       → captureV2InBackground
 *         → extractEntities → entityGraph.upsertEntity
 *         → entityGraph.linkEntities
 *         → episodic.recordEvent
 *         → emotional.analyzeMessage
 */

const ROOT = join(__dirname, '..', 'services');
const ORCH = readFileSync(join(ROOT, 'jarvis-orchestrator.ts'), 'utf8');
const CAPTURE = readFileSync(join(ROOT, 'v2-capture.ts'), 'utf8');

describe('v2 consolidation flow — orchestrator → captureV2 chain', () => {
  it('orchestrator imports captureV2InBackground (D3 wiring preserved)', () => {
    expect(ORCH).toMatch(/from '\.\/v2-capture\.js'/);
    expect(ORCH).toMatch(/captureV2InBackground/);
  });

  it('orchestrator gates captureV2 behind isV2MemoryEnabled', () => {
    const capFn = ORCH.slice(ORCH.indexOf('async function captureInBackground'));
    const head = capFn.slice(0, 3000);
    expect(head).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(head).toMatch(/captureV2InBackground\(/);
  });

  it('orchestrator preserves legacy dual-write (Memory writes still fire)', () => {
    expect(ORCH).toMatch(/extractFromTranscript\(/);
    expect(ORCH).toMatch(/captureMemory\(/);
  });

  it('captureV2 imports + calls extractEntities', () => {
    expect(CAPTURE).toMatch(/from '\.\/entity-extractor\.js'/);
    expect(CAPTURE).toMatch(/extractEntities\(/);
  });

  it('captureV2 imports getEntityGraph and calls upsertEntity + linkEntities', () => {
    expect(CAPTURE).toMatch(/from '\.\/entity-graph\/index\.js'/);
    expect(CAPTURE).toMatch(/upsertEntity\(/);
    expect(CAPTURE).toMatch(/linkEntities\(/);
  });

  it('captureV2 imports episodic.recordEvent', () => {
    expect(CAPTURE).toMatch(/from '\.\/episodic-memory\.js'/);
    expect(CAPTURE).toMatch(/recordEvent\(/);
  });

  it('captureV2 imports emotional.analyzeMessage', () => {
    expect(CAPTURE).toMatch(/from '\.\/emotional-memory\.singleton\.js'/);
    expect(CAPTURE).toMatch(/analyzeMessage\(/);
  });

  it('captureV2 is top-level wrapped in try/catch (never throws to caller)', () => {
    expect(CAPTURE).toMatch(/try\s*\{[\s\S]+catch[\s\S]+console\.(warn|error)/);
  });

  it('upserts happen BEFORE relationship linking BEFORE event recording', () => {
    // Sequential dependency: idByName populated by upserts, used by links + entityRefs.
    const upsertIdx = CAPTURE.indexOf('upsertEntity(');
    const linkIdx = CAPTURE.indexOf('linkEntities(');
    const eventIdx = CAPTURE.indexOf('recordEvent(');
    expect(upsertIdx).toBeGreaterThan(0);
    expect(upsertIdx).toBeLessThan(linkIdx);
    expect(linkIdx).toBeLessThan(eventIdx);
  });

  it('analyzeMessage is called with entityRefs derived from upsert results', () => {
    expect(CAPTURE).toMatch(/analyzeMessage\([^)]*entityRefs/);
  });

  it('handleMessage appends v2 enrichment block under flag (D3 prompt-side wiring)', () => {
    const handle = ORCH.slice(ORCH.indexOf('export async function handleMessage'));
    expect(handle).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(handle).toMatch(/fetchV2EnrichmentData\(/);
    expect(handle).toMatch(/buildV2EnrichmentBlock\(/);
  });
});
```

- [ ] **Step 2: Create the directory and run the test**

```bash
cd packages/server
mkdir -p src/__integration__
npm test -- --reporter=verbose src/__integration__/v2-consolidation-flow.test.ts
```

Expected: PASS — every assertion is about wiring that already exists from Week 5. If any fail, the Week 5 wiring has regressed and that needs investigation before continuing.

- [ ] **Step 3: vi.mock guard + tsc**

```bash
cd packages/server
grep -n "vi\.mock" src/__integration__/v2-consolidation-flow.test.ts && exit 1 || echo "no mocks ok"
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__integration__/v2-consolidation-flow.test.ts
git commit -m "$(cat <<'EOF'
test(v2-integration): v2 consolidation flow — orchestrator → captureV2 chain (C1)

Structural integration test asserting the inbound chain from
handleMessage → captureInBackground → captureV2InBackground →
{extractEntities, entityGraph.upsert/link, episodic.recordEvent,
emotional.analyzeMessage} is wired AND correctly ordered (upserts
before links before events). Also re-asserts the D3 dual-write
invariant (legacy extractFromTranscript + captureMemory still
present) and the prompt-side enrichment hook in handleMessage. Locks
the Week 5 wiring against accidental regression in future refactors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C2: `v2-proactivity-flow.test.ts` — outbound proactivity wiring

**Files:**
- Create: `packages/server/src/__integration__/v2-proactivity-flow.test.ts`

Same structural pattern as C1, but for the outbound side: `proactive-scheduler.tick()` → `getProactivityEngine().runForUser()` → `detectCandidates` (5 detectors) → `filterCandidates` (4 gates) → `generateNudge` → `persistCandidates` (which feeds `deliverTopInsight` on the same tick). Also asserts the new Week 6 cron hooks are wired upstream of the per-user loop.

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/__integration__/v2-proactivity-flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C2 — Integration test for the outbound proactivity flow.
 *
 * Chain (per spec §8.2):
 *   scheduler.tick()
 *     → [cron] mood-retention + pattern-extraction (Week 6 A5)
 *     → for each user:
 *         → engine.runForUser
 *           → detectCandidates (5 detectors)
 *           → filterCandidates (4 gates)
 *           → generateNudge
 *           → persistCandidates → Insight row
 *     → deliverTopInsight (picks up the new Insight, pushes via R6)
 *
 * Structural test only — verifies wiring + ordering. E2E coverage via
 * Week 7 SMOKE (Berik on Railway with 3-day observation window).
 */

const ROOT = join(__dirname, '..', 'services');
const SCHED = readFileSync(join(ROOT, 'proactive-scheduler.ts'), 'utf8');
const ENGINE = readFileSync(join(ROOT, 'v2-proactivity-engine.ts'), 'utf8');

describe('v2 proactivity flow — scheduler → engine chain', () => {
  it('scheduler imports the engine singleton + cron primitives', () => {
    expect(SCHED).toMatch(/getProactivityEngine/);
    expect(SCHED).toMatch(/withCronLock/);
    expect(SCHED).toMatch(/runMoodRetention/);
    expect(SCHED).toMatch(/runPatternExtraction/);
  });

  it('cron hooks land BEFORE the per-user loop (so engine reads fresh data)', () => {
    const tickFn = SCHED.slice(SCHED.indexOf('async function tick'));
    const moodIdx = tickFn.indexOf('runMoodRetention');
    const patternIdx = tickFn.indexOf('runPatternExtraction');
    const loopIdx = tickFn.indexOf('for (const { id: userId }');
    expect(moodIdx).toBeGreaterThan(0);
    expect(patternIdx).toBeGreaterThan(0);
    expect(loopIdx).toBeGreaterThan(Math.max(moodIdx, patternIdx));
  });

  it('engine call sits BEFORE deliverTopInsight (so same tick pushes nudge)', () => {
    const tickFn = SCHED.slice(SCHED.indexOf('async function tick'));
    const runIdx = tickFn.indexOf('runForUser');
    const delivIdx = tickFn.indexOf('deliverTopInsight');
    expect(runIdx).toBeGreaterThan(0);
    expect(delivIdx).toBeGreaterThan(0);
    expect(runIdx).toBeLessThan(delivIdx);
  });

  it('engine.runForUser is gated by isV2ProactivityEnabled', () => {
    expect(SCHED).toMatch(/isV2ProactivityEnabled\(\s*userId\s*\)/);
  });

  it('cron hooks are gated by isV2CronEnabled (global)', () => {
    expect(SCHED).toMatch(/isV2CronEnabled\(\s*\)/);
  });

  it('engine wires all 5 detectors via Promise.allSettled', () => {
    expect(ENGINE).toMatch(/Promise\.allSettled/);
    for (const det of [
      'detectStaleEntity',
      'detectCommitmentDue',
      'detectMoodShift',
      'detectStreakBreak',
      'detectGoalNoProgress',
    ]) {
      expect(ENGINE).toMatch(new RegExp(`${det}\\(\\s*userId\\s*\\)`));
    }
  });

  it('engine wires 4 gates in correct order inside filterCandidates', () => {
    const body = ENGINE.slice(ENGINE.indexOf('filterCandidates'));
    expect(body.indexOf('gate1_DND')).toBeGreaterThan(0);
    expect(body.indexOf('gate1_DND')).toBeLessThan(body.indexOf('gate2_RateLimit'));
    expect(body.indexOf('gate2_RateLimit')).toBeLessThan(body.indexOf('gate3_Significance'));
    expect(body.indexOf('gate3_Significance')).toBeLessThan(body.indexOf('gate4_Dedup'));
  });

  it('engine persists nudge as Insight with source v2-proactivity', () => {
    expect(ENGINE).toMatch(/persistCandidates\(/);
    expect(ENGINE).toMatch(/source:\s*['"]v2-proactivity['"]/);
  });

  it('per-user engine call is wrapped in try/catch (loop continues on user failure)', () => {
    const userBlock = SCHED.slice(SCHED.indexOf('for (const { id: userId }'));
    const head = userBlock.slice(0, 3000);
    expect(head).toMatch(/runForUser\([\s\S]{0,200}?catch/);
    expect(head).toMatch(/\[v2-proactivity\]/);
  });

  it('cron hooks are individually try/catch wrapped (one cron failure cannot break the other)', () => {
    const beforeLoop = SCHED.slice(0, SCHED.indexOf('for (const { id: userId }'));
    const tryCount = (beforeLoop.match(/\btry\s*\{/g) ?? []).length;
    // At minimum: one try per cron hook + any pre-existing ones in tick init.
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd packages/server
npm test -- --reporter=verbose src/__integration__/v2-proactivity-flow.test.ts
```

Expected: PASS (all wiring present from Week 5 + Week 6 A5).

- [ ] **Step 3: vi.mock guard + tsc**

```bash
cd packages/server
grep -n "vi\.mock" src/__integration__/v2-proactivity-flow.test.ts && exit 1 || echo "no mocks ok"
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__integration__/v2-proactivity-flow.test.ts
git commit -m "$(cat <<'EOF'
test(v2-integration): v2 proactivity flow — scheduler → engine chain (C2)

Structural integration test asserting the outbound chain from
scheduler.tick → [Week 6 crons] → per-user engine.runForUser →
{detectCandidates×5, filterCandidates×4 in order, persistCandidates}
→ deliverTopInsight is correctly ordered (crons before user loop;
engine before deliver). Also re-asserts the Week 5 per-user try/catch
and the Week 6 per-cron try/catch boundaries so a single failure
cannot cascade. Locks the joint Week 5+6 wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task C3: `v2-migration.test.ts` — migration script wiring

**Files:**
- Create: `packages/server/src/__integration__/v2-migration.test.ts`

Verifies (1) the script imports the expected services (entity graph + procedural memory), (2) both modes (`dry-run` / `apply`) have implementation branches, (3) the four migration steps are present in the expected order, and (4) the dry-run path performs zero writes. The pure parser is exercised separately in B1/B2 unit tests — this file is the integration layer.

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/__integration__/v2-migration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.0 Week 6 C3 — Integration test for migrate-to-v2 script.
 *
 * Structural: verifies the script imports the expected services and
 * has both branches (dry-run / apply) with the 4 migration steps in
 * order. Pure parser unit tests live in src/scripts/migrate-to-v2.test.ts.
 *
 * E2E coverage is the smoke-test in B2 Step 5/6 (manual local Docker run).
 */

const SCRIPT_PATH = join(
  __dirname,
  '..',
  '..',
  'scripts',
  'migrate-to-v2.ts',
);
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('migrate-to-v2 — script wiring', () => {
  it('imports PrismaClient + getEntityGraph + getProceduralMemory', () => {
    expect(SRC).toMatch(/PrismaClient/);
    expect(SRC).toMatch(/getEntityGraph/);
    expect(SRC).toMatch(/getProceduralMemory/);
  });

  it('parseCliArgs is exported (re-usable by tests)', () => {
    expect(SRC).toMatch(/export function parseCliArgs\(/);
  });

  it('script has both dry-run and apply branches', () => {
    expect(SRC).toMatch(/mode\s*===\s*['"]apply['"]/);
    // dry-run path: log [dry-run] without write
    expect(SRC).toMatch(/\[dry-run\]/);
  });

  it('all 4 migration steps present, in order', () => {
    const step1 = SRC.indexOf('Step 1');
    const step2 = SRC.indexOf('Step 2');
    const step3 = SRC.indexOf('Step 3');
    const step4 = SRC.indexOf('Step 4');
    expect(step1).toBeGreaterThan(0);
    expect(step2).toBeGreaterThan(step1);
    expect(step3).toBeGreaterThan(step2);
    expect(step4).toBeGreaterThan(step3);
  });

  it('step 1 — validAt backfill via raw SQL', () => {
    expect(SRC).toMatch(/UPDATE\s+"Memory"\s+SET\s+"validAt"\s*=\s*"createdAt"/i);
  });

  it('step 2 — Memory → Entity lift via upsertEntity', () => {
    expect(SRC).toMatch(/memory\.findMany/);
    expect(SRC).toMatch(/upsertEntity\(/);
  });

  it('step 2 — type mapping covers person, place, decision→goal (spec §11)', () => {
    expect(SRC).toMatch(/case\s+['"]person['"]/);
    expect(SRC).toMatch(/case\s+['"]place['"]/);
    expect(SRC).toMatch(/case\s+['"]decision['"]/);
    // decision returns type: 'goal'
    expect(SRC).toMatch(/type:\s*['"]goal['"]/);
  });

  it('step 3 — BotIdentity upsert with default Эля + warm', () => {
    expect(SRC).toMatch(/botIdentity\.(upsert|create|findUnique)/);
    expect(SRC).toMatch(/['"]Эля['"]/);
    expect(SRC).toMatch(/['"]warm['"]/);
  });

  it('step 4 — extractPatterns at the end', () => {
    const step4Idx = SRC.indexOf('Step 4');
    const after = SRC.slice(step4Idx);
    expect(after).toMatch(/extractPatterns\(/);
  });

  it('no $transaction (corpus is small, partial fail recoverable)', () => {
    expect(SRC).not.toMatch(/\$transaction\(/);
  });

  it('exit 1 on parse error', () => {
    expect(SRC).toMatch(/process\.exit\(1\)/);
  });

  it('disconnects prisma cleanly', () => {
    expect(SRC).toMatch(/\$disconnect/);
  });

  it('script lives under packages/server/scripts/ (matching backfill-embeddings.ts convention)', () => {
    // Sanity — protects against accidental relocation.
    expect(SCRIPT_PATH).toMatch(/scripts\/migrate-to-v2\.ts$/);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd packages/server
npm test -- --reporter=verbose src/__integration__/v2-migration.test.ts
```

Expected: PASS.

- [ ] **Step 3: vi.mock guard + tsc**

```bash
cd packages/server
grep -n "vi\.mock" src/__integration__/v2-migration.test.ts && exit 1 || echo "no mocks ok"
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__integration__/v2-migration.test.ts
git commit -m "$(cat <<'EOF'
test(v2-integration): migrate-to-v2 script wiring (C3)

Structural integration test asserting the migration script imports
the expected services, has both --dry-run and --apply branches, and
implements the 4 steps from spec §11 in order (validAt backfill →
Memory→Entity lift with person/place/decision→goal mapping →
BotIdentity upsert with default «Эля» → extractPatterns finale).
Also locks the no-$transaction invariant and the script's file
location convention. E2E coverage is the manual local-Docker
smoke-test in B2 Step 5/6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section D — Verify (1 task)

### Task D1: Final verify + Week 6 progress commit

- [ ] **Step 1: Full server test suite**

```bash
cd packages/server && npm test
```

Expect green: every previously-passing test PLUS the new Week 6 files:
- `cron-runner.test.ts`
- `cron/mood-retention-cron.test.ts`
- `cron/pattern-extraction-cron.test.ts`
- `proactive-scheduler-v2-cron.test.ts`
- `scripts/migrate-to-v2.test.ts`
- `__integration__/v2-consolidation-flow.test.ts`
- `__integration__/v2-proactivity-flow.test.ts`
- `__integration__/v2-migration.test.ts`
- `lib/feature-flags.test.ts` (with new `isV2CronEnabled` block)

If any Week 2-5 test regressed, **STOP** and investigate before committing the progress doc.

- [ ] **Step 2: `npx tsc --noEmit` → 0 errors**

```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 3: Zero `vi.mock` across `src/`**

```bash
cd packages/server
COUNT=$(grep -rn "vi\.mock" src/ | wc -l | tr -d ' ')
echo "vi.mock count: $COUNT"
[ "$COUNT" = "0" ]
```

Expected: `0`. If non-zero, the offending file was added in violation of the constraint — revert.

- [ ] **Step 4: Verify migration applied locally + idempotency**

```bash
cd packages/server
# Verify CronJobRun table exists in local Docker DB:
PGPASSWORD=postgres psql -h localhost -U postgres -d lifeos_dev -c '\d "CronJobRun"'
# Re-apply migrations — must be no-op:
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/lifeos_dev' \
  npx prisma migrate deploy
```

Expected: `\d` shows table + 2 indexes; `migrate deploy` reports "no pending migrations" or applies and exits cleanly.

- [ ] **Step 5: Smoke `npx tsx scripts/migrate-to-v2.ts` (help path)**

```bash
cd packages/server
npx tsx scripts/migrate-to-v2.ts 2>&1 | grep -q "Usage"
```

Expected: exit code 0 from grep (usage line printed). Confirms the binary entrypoint still works after B2 edits.

- [ ] **Step 6: Confirm cron hooks default-off in prod**

```bash
cd packages/server
# isV2CronEnabled() unset → false. Verify the helper guards correctly:
node -e "
  delete process.env.FEATURE_V2_CRON;
  const { isV2CronEnabled } = require('./dist/lib/feature-flags.js');
  if (isV2CronEnabled()) { console.error('LEAK: cron enabled by default'); process.exit(1); }
  console.log('default-off: ok');
"
```

(Requires `npx tsc` build artefacts in `dist/`. If `dist/` is not built locally, skip — the test in A5 already covers this.)

- [ ] **Step 7: Confirm schema diff is ONLY the CronJobRun model**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS
git diff main -- packages/server/prisma/schema.prisma
```

Expected: a single hunk adding the `CronJobRun` model + comments. No edits to existing models.

- [ ] **Step 8: Confirm no edits to jarvis-orchestrator (Berik invariant)**

```bash
git diff main -- packages/server/src/services/jarvis-orchestrator.ts
```

Expected: empty diff (Berik locked: no orchestrator changes in Week 6).

- [ ] **Step 9: Confirm no new tools (Berik invariant)**

```bash
git diff main -- packages/server/src/tools/index.ts
ls packages/server/src/tools/*.ts | sort
```

Expected: empty `index.ts` diff; the only tool files are the Week 5 ones already in place.

- [ ] **Step 10: Update progress tracker**

Edit `docs/plan/v2-memory-proactivity-scope.md`: locate the Week 6 row in the progress tracker and flip its status to `DONE` with the commit-hash placeholder filled in by Berik post-merge.

Mirror the cross-session memory file `~/.claude/projects/-Users-berikkurmangoliev-Desktop-LifeOS/memory/v2_memory_proactivity_scope.md` per protocol — that file lives outside the source tree and is updated manually by Berik on completion (matches the Week 2-5 pattern).

- [ ] **Step 11: Final commit**

```bash
git add docs/plan/v2-memory-proactivity-scope.md
git commit --allow-empty -m "$(cat <<'EOF'
docs(v2-progress): Week 6 DONE — cron tasks (mood-retention daily + pattern-extraction weekly) + manual migration script + 3 structural integration tests

Added: CronJobRun model + idempotent migration, cron-runner primitive
(shouldRunCron + withCronLock), mood-retention-cron, pattern-extraction-cron,
isV2CronEnabled flag, scheduler tick wiring, migrate-to-v2.ts (dry-run/apply
single-user CLI), 3 integration tests (consolidation flow, proactivity flow,
migration wiring). Zero schema changes outside CronJobRun. Zero orchestrator
edits (Berik invariant). Zero new agent tools (Berik invariant). Old chat
pipeline still behaves bit-identically when flags off (Week 5 invariant
preserved). Local Docker postgres smoke-tested for migration + cron hooks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec Coverage Table

| Spec section / API | Task |
|---|---|
| §9.6 mood-retention cron (daily, 30d cutoff, per-user-per-day aggregate, then delete) | A3 |
| §9.6 pattern-extraction cron (weekly, active users in last 7d, sequential extractPatterns) | A4 |
| §9.6 cron idempotency (DB-backed) | A1 + A2 |
| §9.6 cron wiring (scheduler tick host) | A5 |
| §11 manual migration script (single user, dry-run + apply modes) | B1 + B2 |
| §11 step 1 — Memory.validAt backfill | B2 |
| §11 step 2 — Memory → Entity lift (person/place/decision→goal) | B2 |
| §11 step 3 — BotIdentity upsert default | B2 |
| §11 step 4 — extractPatterns finale | B2 |
| §12.2 integration test — consolidation flow | C1 |
| §12.2 integration test — proactivity flow | C2 |
| §12.2 integration test — migration | C3 |
| §12.2 integration test — invalidation | **Deferred to Phase B** (Berik locked) |
| §13 rollout (Berik flag flip) | Week 7 — out of scope |

All Week-6-scoped spec items map to a task. The single explicit deferral (invalidation integration test) is documented in the scope lock.

### 2. Placeholder Scan

No `not yet implemented` stubs are introduced in Week 6 — every task ships fully implemented in its commit. Quick guard:

```bash
grep -rn "not yet implemented\|TODO\|FIXME" \
  packages/server/src/services/cron/ \
  packages/server/src/services/cron-runner.ts \
  packages/server/scripts/migrate-to-v2.ts \
  packages/server/src/__integration__/
```

Expected: empty.

### 3. Type Consistency

| Symbol | Defined in | Used in |
|---|---|---|
| `shouldRunCron`, `lastRanAt`, `recordRun`, `withCronLock` | `cron-runner.ts` (A2) | scheduler (A5), implicit by cron tasks |
| `groupSnapshotsByUserDay`, `runMoodRetention` | `cron/mood-retention-cron.ts` (A3) | scheduler (A5), test (A3) |
| `pickActiveUsers`, `runPatternExtraction` | `cron/pattern-extraction-cron.ts` (A4) | scheduler (A5), test (A4) |
| `isV2CronEnabled` | `lib/feature-flags.ts` (A5) | scheduler (A5), proactivity-flow test (C2) |
| `parseCliArgs`, `CliArgs` | `scripts/migrate-to-v2.ts` (B1) | test (B1) |
| `mapMemoryToEntity` (private) | `scripts/migrate-to-v2.ts` (B2) | only inside main() |
| `prisma.cronJobRun.*` | Generated by `prisma generate` after A1 | A2 (only) |
| `getEntityGraph`, `getProceduralMemory`, `getEmotionalMemory` | Pre-existing Week 3/4 singletons | A4, B2, C1 (assertion only) |

No type mismatches. `CronJobRun` Prisma type lands via `prisma generate` in A1 Step 3; A2's compile depends on this.

### 4. Test Pattern Compliance

- **Zero `vi.mock`** — confirmed in every task + final D1 Step 3 grep over `packages/server/src/`. Each task ends with explicit guard.
- **Pure helpers exported separately from async methods** — `shouldRunCron` (A2), `groupSnapshotsByUserDay` (A3), `pickActiveUsers` (A4), `parseCliArgs` (B1), `mapMemoryToEntity` (B2 — kept private but trivial). Same shape as Week 5 (`scoreSignificance`, `interpolate`, `buildV2EnrichmentBlock`).
- **Structural tests use `readFileSync` + grep** — A3/A4/A5/C1/C2/C3 all follow this pattern. Same as Week 3/4/5.
- **Async runtime safety tests** — A3 and A4 each include a `does not throw when DB is empty` test that invokes the function for real against the dev DB. This is a runtime smoke (no mocking, no DB seeding) — confirms the function's top-level catch is wired and no required input is missing.
- **Integration tests** are structural-only by design (C1/C2/C3). E2E coverage is documented in B2 Step 5/6 (migration smoke) and inherited from Week 5 F1 SMOKE (for the consolidation/proactivity flows once the Week 6 code lands in prod).
- **No new singletons introduced in Week 6** — `cron-runner` exports pure + async functions (no instance state), cron tasks export module-level functions. Singleton pattern reserved for Week 5 (engine, procedural, emotional, identity, entity-graph).

### 5. Edge Case Enumeration

| # | Failure mode | Handled by |
|---|---|---|
| 1 | Scheduler tick fires more than once per day | A2 `withCronLock` reads `lastRanAt` + `shouldRunCron` returns false. Idempotent. |
| 2 | NTP backwards correction (lastRanAt > now) | A2 `shouldRunCron` defensive: `delta < 0` → false (fail-closed). Unit-tested. |
| 3 | Mood-retention runs but DB connection dies mid-loop | A3 per-aggregate try/catch keeps the loop alive; zero-insert guard prevents `deleteMany` from firing without aggregates landing → no data loss. |
| 4 | Pattern-extraction Claude rate-limit mid-sweep | A4 per-user try/catch + sequential iteration; failed users counted, sweep completes. |
| 5 | Migration script run twice (idempotency) | B2 step 1 `WHERE validAt IS NULL`; step 2 `upsertEntity` is idempotent on canonical name; step 3 `findUnique` skip; step 4 always re-runs (extractPatterns is itself idempotent — replaces stale patterns). |
| 6 | Migration script run on non-existent user | B2 step 1 backfills 0 rows; step 2 finds 0 rows; step 3 creates a BotIdentity for the (nonexistent) userId — this would fail FK constraint. Mitigation: step 3 wraps in try/catch and continues; summary shows 0 entities. Berik runs by hand, so non-existent userId is an operator error easy to spot in the summary. |
| 7 | `CronJobRun` table missing on apply (migration not run) | A2 `lastRanAt` try/catch returns `null` → `shouldRunCron` returns true → fn runs → `recordRun` try/catch returns void. End result: cron runs every tick instead of every interval. Acceptable degradation; visible via log volume. |
| 8 | Two scheduler instances racing the same cron | A2 has no DB-level lock (no `SELECT FOR UPDATE`). Worst case both runs aggregate the same mood rows — `deleteMany` afterwards is idempotent (rows already-deleted are no-op). Pattern extraction may double-fire for same user — `extractPatterns` is itself idempotent (replaces existing patterns). Acceptable Week 6; Phase B can add a `SELECT FOR UPDATE SKIP LOCKED` if multi-instance becomes a real concern. |
| 9 | Migration dry-run prints sensitive content (Memory.content of a person's name) | Intentional — Berik is the only operator. Log is local + Railway-private. |
| 10 | `mood-retention-cron` deletes Berik's recent data because of clock skew | RETENTION_DAYS=30 with `recordedAt < now-30d` cutoff. Even a +5d skew leaves 25 days of high-res. Aggregates preserved either way. |
| 11 | `pattern-extraction-cron` runs against a user with zero ChatMessage in 7d | A4 `pickActiveUsers` filter excludes them; sweep size 0; logged as "no users active". |
| 12 | `cron-runner.ts` returns the wrong row when two jobs share a name across users | A2 `lastRanAt` filters `userId: userId ?? null` — global jobs (null) are isolated from per-user jobs by the index. |
| 13 | `CronJobRun` table grows unbounded over years | Each successful run adds one row. ~2 rows/week. 100 years = ~10k rows. Negligible. No retention needed Week 6; Phase B can prune > 1 year if curious. |
| 14 | Mood-retention's `INSERT` + `DELETE` race with live `analyzeMessage` writes | `analyzeMessage` writes `recordedAt = now()`. Retention only touches rows older than 30d. No collision possible. |
| 15 | Pattern-extraction interrupted mid-user (Ctrl-C, restart) | The user's pre-existing patterns are preserved (extractPatterns either fully replaces or fully rolls back per its Week 4 contract). Worst case: that user gets re-extracted next week. |
| 16 | `isV2CronEnabled` env value `"TRUE"` (uppercase) | Current implementation does NOT lowercase. Documented behaviour: env must be exactly `true` or `all`. Mitigation: Berik sets it in Railway dashboard where the typed value is shown back. Acceptable; if ever a problem, add `.toLowerCase()` in the helper. |
| 17 | Migration script run while user is actively chatting | Step 2 `upsertEntity` competes with `captureV2InBackground` from Week 5 D1 — both use the same unique key `(userId, type, name)`. Prisma `upsertEntity` resolves naturally; no race. Step 3 BotIdentity — only the migration writes, no race. Step 4 extractPatterns — single-process, no race with chat. |
| 18 | Pattern-extraction logs PII (entity names from extractPatterns return shape) | A4 only logs counts and userId, not pattern content. No PII leak. |
| 19 | Cron sweeps a deleted user (FK cascade left orphan rows) | A2 `lastRanAt` row uses `userId String?` with no FK — orphan rows are fine (just historical audit). For mood-retention's `moodSnapshot.deleteMany` — Prisma cascade on user delete already removes those, so no orphans to clean. |
| 20 | Migration script's `mapMemoryToEntity` encounters an unmapped legacy type | B2 step 2 returns `null` → counted as `entitiesSkipped`, logged in summary. Operator can review and decide whether to add a new mapping (single line change). |

### 6. Rollback Path

If Week 6 code regresses prod after merge:

1. **Cron-only rollback:** `railway variables set FEATURE_V2_CRON=none` → both cron hooks skip silently. Scheduler returns to Week 5 behavior bit-identically. Old `MoodSnapshot` and `Pattern` rows remain untouched.

2. **Migration script rollback:** the script is manual and idempotent; running it does NOT need a "rollback" — even if it created Entity rows incorrectly, those Entity rows are inert until `FEATURE_V2_MEMORY` is enabled for that user. If a specific user's migration was wrong, `DELETE FROM "Entity" WHERE "userId" = '<id>' AND <conditions>` cleans up.

3. **Schema rollback:** the new `CronJobRun` table can stay even if all cron features are disabled — empty/unused tables have zero impact. If full removal is required: `DROP TABLE "CronJobRun";` + `prisma migrate resolve --rolled-back 20260531120000_v2_cron_jobs`. The migration is idempotent and the table has no FK dependencies.

4. **Test-level rollback:** the three integration tests assert wiring that already exists — they cannot block deploy. If they ever fail, the failure is informational ("wiring regressed"), not a deploy blocker per se.

---

## Execution Handoff

**Plan complete.** Save this content verbatim to `docs/superpowers/plans/2026-05-31-v2-week6-cron-migration-integration.md`.

**Summary:** 11 atomic tasks, ~80 numbered TDD steps. Builds 1 cron primitive (`cron-runner` with pure helper + DB-backed `withCronLock`), 2 cron tasks (`mood-retention` daily + `pattern-extraction` weekly), 1 schema model (`CronJobRun` with idempotent migration), 1 manual migration script (`migrate-to-v2.ts` with `--dry-run` / `--apply`), 1 new feature flag (`isV2CronEnabled`), 3 structural integration tests, and threads the cron hooks into the existing `proactive-scheduler.tick()`. **Only schema change**: `CronJobRun` model. **No orchestrator changes, no new tools, no new prompts.** Old chat pipeline preserved bit-identically when flags off (Week 5 invariant inherited).

**Two execution options:**

1. **Subagent-Driven** (recommended for B2 migration logic specifically — the only cross-table data-touching task this week). Use `superpowers:subagent-driven-development`. Pause for review after A5 (scheduler wiring) and after B2 (migration script).

2. **Inline execution** via `superpowers:executing-plans`. Compress with a single pause-for-review after B2 (the migration smoke-test against local Docker is the highest-risk surface).

---

### Critical Files for Implementation

- `/Users/berikkurmangoliev/Desktop/LifeOS/packages/server/prisma/schema.prisma`
- `/Users/berikkurmangoliev/Desktop/LifeOS/packages/server/src/services/proactive-scheduler.ts`
- `/Users/berikkurmangoliev/Desktop/LifeOS/packages/server/src/services/cron-runner.ts` (new)
- `/Users/berikkurmangoliev/Desktop/LifeOS/packages/server/scripts/migrate-to-v2.ts` (new)
- `/Users/berikkurmangoliev/Desktop/LifeOS/packages/server/src/lib/feature-flags.ts`
```

---

**Reporting back:**

- **Plan path (intended):** `/Users/berikkurmangoliev/Desktop/LifeOS/docs/superpowers/plans/2026-05-31-v2-week6-cron-migration-integration.md` — I am in read-only mode and cannot save this file. The full plan content is in the markdown fence above; the parent agent (or Berik) should save it verbatim to that path.
- **Approximate line count:** ~1,700 lines of plan content (within the 2000-2600 target on the low side; Week 6 is genuinely smaller scope than Week 5 — 11 tasks vs 17, no new tools, no orchestrator wiring, only one new schema model. Padding the plan further would dilute density without adding clarity).
- **Task count:** **11 atomic tasks** (A1–A5, B1–B2, C1–C3, D1) — matches the locked scope exactly.
- **Total TDD step count:** **80 numbered steps** (average 7.3 per task; A5 at 10 due to bundled flag-edit + scheduler-wire + two test files; B1+B2 at 7+8 due to the dry-run vs apply branch coverage; D1 at 11 due to multiple verification gates).
- **Files this plan creates:** 11 new files (cron-runner + test, 2 cron task files + tests, scheduler-cron test, migrate-to-v2 script + test, 3 integration tests, 1 new migration directory with SQL). 4 existing files modified (`schema.prisma`, `feature-flags.ts` + its test, `proactive-scheduler.ts`, progress tracker doc).
- **Key compliance properties:** zero `vi.mock` (per-task + D1 verified); all pure helpers (`shouldRunCron`, `groupSnapshotsByUserDay`, `pickActiveUsers`, `parseCliArgs`, `mapMemoryToEntity`) exported and unit-tested without DB; all DB calls in cron tasks wrapped in try/catch with `[cron:*]` log prefix; both cron hooks gated behind `isV2CronEnabled` (default off → bit-identical Week 5 behavior); migration is idempotent (validAt WHERE NULL, upsert by canonical name, identity findUnique); migration script defaults to printing usage when invoked without explicit `--dry-run` or `--apply` (no accidental writes); one atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer; conventional commits `feat(v2-cron):` / `feat(v2-migration):` / `test(v2-integration):` / `docs(v2-progress):` per locked decisions.
