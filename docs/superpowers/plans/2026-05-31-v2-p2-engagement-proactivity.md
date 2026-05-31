# v2 — P2 Engagement-Aware Proactivity (lean) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make proactivity engagement-aware — raise/lower the significance bar by recent responsiveness, and defer non-critical delivery to the user's active hours — with no new table.

**Architecture:** An `engagement` service computes a per-user `{receptiveness, activeHours}` best-effort from existing rows (InsightDismissal + Insight.deliveredAt + ChatMessage). Pure helpers turn that into an adaptive significance threshold (wired into the proactivity gate3 + Reflector v2 event gate) and a receptive-hour delivery decision (wired into deliverTopInsight). All gated by `isV2EngagementEnabled`; off → today's fixed behavior byte-for-byte.

**Tech Stack:** TypeScript strict, Prisma (read-only reuse, no schema change), vitest (pure unit + structural readFileSync+grep, zero vi.mock), feature flag `isV2EngagementEnabled`.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-p2-engagement-proactivity-design.md` (approved by Berik 2026-05-31).

---

## CRITICAL repo facts (read before any task)
- Work on branch **`main`** in **`/Users/berikkurmangoliev/Desktop/LifeOS`** (NOT the worktree). Start EVERY bash command with `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && ...`.
- **NO schema change / migration. NO `prisma migrate`/`db push`** (`.env` DATABASE_URL is PROD). No `prisma generate` needed.
- Commit per step, LOCAL only (never `git push`), heredoc message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Commands: `npx tsc --noEmit`, `npx vitest run <path>`, `npx vitest run`.
- **Verified signatures (implementer should still open each file to confirm):**
  - `gate3_Significance(c: NudgeCandidate, threshold = 0.6): boolean` in `src/services/v2-proactivity-engine.ts`; called at ~L584 `if (!gate3_Significance(c)) continue;` inside `filterCandidates`.
  - `deliverTopInsight(userId, now)` in `src/services/insight-store.ts` — computes `const hour = localHour(tz, now)`, builds `undelivered` (each has `severity`), `chooseInsightToPush(...)`, then `const row = undelivered.find(r => r.id === chosen.id)!` before delivering.
  - `severityBand(sev): 'info'|'warning'|'critical'` in `src/services/insight-core.ts` — `sev >= 8 → 'critical'`.
  - `reflector-v2/index.ts` `runEventCheck`: `if (!shouldFireEvent(facts)) return { emitted: false };`. `shouldFireEvent` + `significanceScore` + `EVENT_THRESHOLD = 0.6` in `reflector-v2/types.ts`.
  - `localHour(tz, date)` from `../lib/tz.js`. `Insight` has `deliveredAt`, `severity`. `InsightDismissal {userId, dismissKey, createdAt}`. `ChatMessage {userId, role, createdAt}`. `User.timezone`.

## File Structure
| File | Responsibility |
|---|---|
| `src/services/engagement/types.ts` | pure helpers (receptivenessScore, adaptiveThreshold, activeHourHistogram, isReceptiveHour) |
| `src/services/engagement/engagement.ts` | getEngagement best-effort read → {receptiveness, activeHours} |
| `src/services/engagement/index.ts` | getEngagementStore() singleton + re-exports |
| `src/lib/feature-flags.ts` | isV2EngagementEnabled |
| `src/services/v2-proactivity-engine.ts` | gate3 adaptive threshold |
| `src/services/reflector-v2/index.ts` | runEventCheck adaptive event threshold |
| `src/services/insight-store.ts` | deliverTopInsight receptive-hour defer |
| `src/__integration__/v2-engagement-flow.test.ts` | structural integration |

---

## Task B1: engagement/types.ts + pure helpers

**Files:**
- Create: `packages/server/src/services/engagement/types.ts`
- Test: `packages/server/src/services/engagement/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/engagement/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  receptivenessScore,
  adaptiveThreshold,
  activeHourHistogram,
  isReceptiveHour,
} from './types.js';

describe('receptivenessScore', () => {
  it('no deliveries → neutral 0.5', () => {
    expect(receptivenessScore(0, 0, 0)).toBe(0.5);
  });
  it('all replied, none dismissed → high', () => {
    expect(receptivenessScore(10, 0, 10)).toBeGreaterThan(0.8);
  });
  it('all dismissed, none replied → low', () => {
    expect(receptivenessScore(10, 10, 0)).toBeLessThan(0.2);
  });
  it('clamped to [0,1]', () => {
    const s = receptivenessScore(5, 99, 0);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('adaptiveThreshold', () => {
  it('low receptiveness raises the bar', () => {
    expect(adaptiveThreshold(0.6, 0.0)).toBeGreaterThan(0.6);
  });
  it('high receptiveness lowers the bar', () => {
    expect(adaptiveThreshold(0.6, 1.0)).toBeLessThan(0.6);
  });
  it('neutral receptiveness ≈ base', () => {
    expect(adaptiveThreshold(0.6, 0.5)).toBeCloseTo(0.6, 5);
  });
  it('clamped to [base-0.15, base+0.25]', () => {
    expect(adaptiveThreshold(0.6, 0)).toBeLessThanOrEqual(0.6 + 0.25 + 1e-9);
    expect(adaptiveThreshold(0.6, 1)).toBeGreaterThanOrEqual(0.6 - 0.15 - 1e-9);
  });
});

describe('activeHourHistogram', () => {
  it('counts into 24 slots', () => {
    const h = activeHourHistogram([9, 9, 14, 23, 9]);
    expect(h).toHaveLength(24);
    expect(h[9]).toBe(3);
    expect(h[14]).toBe(1);
    expect(h[23]).toBe(1);
    expect(h[0]).toBe(0);
  });
  it('ignores out-of-range hours', () => {
    const h = activeHourHistogram([25, -1, 12]);
    expect(h[12]).toBe(1);
  });
});

describe('isReceptiveHour', () => {
  it('empty/sparse histogram → true (do not block when unknown)', () => {
    expect(isReceptiveHour([], 10)).toBe(true);
    expect(isReceptiveHour(activeHourHistogram([9, 10]), 3)).toBe(true); // <10 total
  });
  it('hour with sufficient share → true', () => {
    const hours = Array.from({ length: 20 }, () => 9); // 20 msgs at hour 9
    expect(isReceptiveHour(activeHourHistogram(hours), 9)).toBe(true);
  });
  it('hour with negligible share → false', () => {
    const hours = Array.from({ length: 20 }, () => 9);
    expect(isReceptiveHour(activeHourHistogram(hours), 3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/types.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement types.ts**

Create `packages/server/src/services/engagement/types.ts`:
```ts
/**
 * v2 P2 — Engagement-aware proactivity: pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-p2-engagement-proactivity-design.md
 *
 * No I/O — unit-tested in isolation. engagement.ts feeds these from DB.
 */

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));

/**
 * Recent responsiveness 0..1. Neutral 0.5 when there's no delivery history.
 * Rewards replies-after-nudge, penalises dismissals.
 */
export function receptivenessScore(
  delivered: number, dismissed: number, repliedWithin: number,
): number {
  if (delivered <= 0) return 0.5;
  const replyRate = clamp(repliedWithin / delivered, 0, 1);
  const dismissRate = clamp(dismissed / delivered, 0, 1);
  return clamp(0.5 + 0.4 * replyRate - 0.4 * dismissRate, 0, 1);
}

/**
 * Adaptive significance threshold around `base`. Low receptiveness → higher
 * bar (pester less); high → lower bar (catch more). Clamped to
 * [base-0.15, base+0.25].
 */
export function adaptiveThreshold(base: number, receptiveness: number): number {
  const raw = base + (0.5 - clamp(receptiveness, 0, 1)) * 0.5;
  return clamp(raw, base - 0.15, base + 0.25);
}

/** 24-slot count histogram of message local-hours (out-of-range ignored). */
export function activeHourHistogram(localHours: number[]): number[] {
  const hist = new Array<number>(24).fill(0);
  for (const h of localHours) {
    if (Number.isInteger(h) && h >= 0 && h < 24) hist[h] += 1;
  }
  return hist;
}

/**
 * Is `hour` a receptive hour? True when we lack enough data to judge
 * (empty or < 10 total messages) — never block on ignorance. Otherwise
 * the hour must hold ≥ minShare of messages.
 */
export function isReceptiveHour(hist: number[], hour: number, minShare = 0.05): boolean {
  if (!Array.isArray(hist) || hist.length !== 24) return true;
  const total = hist.reduce((s, n) => s + n, 0);
  if (total < 10) return true;
  if (!Number.isInteger(hour) || hour < 0 || hour >= 24) return true;
  return hist[hour] / total >= minShare;
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/engagement/types.ts src/services/engagement/types.test.ts
git commit -F - <<'EOF'
feat(v2-p2): engagement pure helpers (B1)

receptivenessScore (0.5 neutral, reward replies / penalise dismissals),
adaptiveThreshold (low receptiveness raises bar, clamped [base-0.15,base+0.25]),
activeHourHistogram (24 slots), isReceptiveHour (sparse → true, else share gate).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B2: engagement.ts — getEngagement (best-effort)

**Files:**
- Create: `packages/server/src/services/engagement/engagement.ts`
- Test: `packages/server/src/services/engagement/engagement.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/engagement/engagement.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/engagement/engagement.ts'), 'utf-8');

describe('getEngagement structure', () => {
  it('exports getEngagement', () => {
    expect(SRC).toMatch(/export async function getEngagement/);
  });
  it('reads the three existing sources', () => {
    expect(SRC).toMatch(/insightDismissal/);
    expect(SRC).toMatch(/deliveredAt/);
    expect(SRC).toMatch(/chatMessage/);
  });
  it('computes via the pure helpers', () => {
    expect(SRC).toMatch(/receptivenessScore/);
    expect(SRC).toMatch(/activeHourHistogram/);
    expect(SRC).toMatch(/localHour/);
  });
  it('degrade-safe: neutral 0.5 + empty hours on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/receptiveness: 0\.5/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/engagement.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement engagement.ts**

Create `packages/server/src/services/engagement/engagement.ts`:
```ts
/**
 * v2 P2 — compute a user's recent engagement best-effort from existing rows
 * (Insight.deliveredAt + InsightDismissal + ChatMessage). Never throws; on any
 * failure returns neutral { receptiveness: 0.5, activeHours: [] }.
 */

import { prisma } from '../../lib/prisma.js';
import { localHour } from '../../lib/tz.js';
import { receptivenessScore, activeHourHistogram } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const REPLY_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface Engagement {
  receptiveness: number;
  activeHours: number[]; // 24-slot histogram (empty array if unknown)
}

export async function getEngagement(userId: string, now: Date = new Date()): Promise<Engagement> {
  try {
    const since14 = new Date(now.getTime() - 14 * DAY);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { timezone: true },
    });
    const tz = user?.timezone ?? 'UTC';

    const [deliveries, dismissed, userMsgs14, userMsgs30] = await Promise.all([
      prisma.insight.findMany({
        where: { userId, deliveredAt: { gte: since14 } },
        select: { deliveredAt: true },
      }),
      prisma.insightDismissal.count({
        where: { userId, createdAt: { gte: since14 } },
      }),
      prisma.chatMessage.findMany({
        where: { userId, role: 'user', createdAt: { gte: since14 } },
        select: { createdAt: true },
      }),
      prisma.chatMessage.findMany({
        where: { userId, role: 'user', createdAt: { gte: since30 } },
        select: { createdAt: true },
      }),
    ]);

    // repliedWithin: nudge deliveries followed by a user message within 6h.
    const msgTimes = userMsgs14.map((m) => m.createdAt.getTime());
    let repliedWithin = 0;
    for (const d of deliveries) {
      if (!d.deliveredAt) continue;
      const t = d.deliveredAt.getTime();
      if (msgTimes.some((mt) => mt > t && mt <= t + REPLY_WINDOW_MS)) repliedWithin += 1;
    }

    const receptiveness = receptivenessScore(deliveries.length, dismissed, repliedWithin);
    const activeHours = activeHourHistogram(
      userMsgs30.map((m) => localHour(tz, m.createdAt)),
    );
    return { receptiveness, activeHours };
  } catch (err) {
    console.warn('[engagement:getEngagement] failed:',
      err instanceof Error ? err.message : err);
    return { receptiveness: 0.5, activeHours: [] };
  }
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/engagement.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (Confirm `localHour(tz, date)` import + `prisma.insightDismissal` delegate exist; both do.)

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/engagement/engagement.ts src/services/engagement/engagement.test.ts
git commit -F - <<'EOF'
feat(v2-p2): getEngagement best-effort reader (B2)

Reads Insight.deliveredAt + InsightDismissal + ChatMessage (last 14/30d) →
{receptiveness, activeHours} via the pure helpers. repliedWithin = nudges
followed by a user msg within 6h. Never throws; failure → neutral 0.5/[].

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B3: engagement/index.ts — singleton + re-exports

**Files:**
- Create: `packages/server/src/services/engagement/index.ts`
- Test: `packages/server/src/services/engagement/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/engagement/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  getEngagement,
  receptivenessScore,
  adaptiveThreshold,
  isReceptiveHour,
} from './index.js';

describe('engagement/index re-exports', () => {
  it('exposes getEngagement + the pure helpers', () => {
    expect(typeof getEngagement).toBe('function');
    expect(typeof receptivenessScore).toBe('function');
    expect(typeof adaptiveThreshold).toBe('function');
    expect(typeof isReceptiveHour).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement index.ts**

Create `packages/server/src/services/engagement/index.ts`:
```ts
/**
 * v2 P2 — engagement public entry point.
 */

export {
  receptivenessScore,
  adaptiveThreshold,
  activeHourHistogram,
  isReceptiveHour,
} from './types.js';

export { getEngagement, type Engagement } from './engagement.js';
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/index.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/engagement/index.ts src/services/engagement/index.test.ts
git commit -F - <<'EOF'
feat(v2-p2): engagement/index re-exports (B3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C1: isV2EngagementEnabled flag + adaptive significance threshold (gate3 + reflector event)

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/reflector-v2/index.ts`
- Test: `packages/server/src/services/engagement/threshold-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/engagement/threshold-wiring.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2EngagementEnabled } from '../../lib/feature-flags.js';

const ENG = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
const REF = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');

describe('isV2EngagementEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_ENGAGEMENT; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_ENGAGEMENT;
    expect(isV2EngagementEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_ENGAGEMENT = 'all';
    expect(isV2EngagementEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_ENGAGEMENT = 'user-u1';
    expect(isV2EngagementEnabled('u1')).toBe(true);
    expect(isV2EngagementEnabled('u2')).toBe(false);
  });
});

describe('adaptive threshold wiring', () => {
  it('proactivity gate3 uses adaptiveThreshold gated by the flag', () => {
    expect(ENG).toMatch(/isV2EngagementEnabled/);
    expect(ENG).toMatch(/adaptiveThreshold/);
    expect(ENG).toMatch(/gate3_Significance\(c, /);
  });
  it('reflector event check uses an adaptive threshold', () => {
    expect(REF).toMatch(/isV2EngagementEnabled/);
    expect(REF).toMatch(/adaptiveThreshold/);
    expect(REF).toMatch(/significanceScore/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/threshold-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the feature flag**

In `src/lib/feature-flags.ts`, append after `isV2ReflectorEnabled`:
```ts
/**
 * v2 P2 — Per-user gate for engagement-aware proactivity. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2EngagementEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_ENGAGEMENT;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Wire gate3 in filterCandidates**

In `src/services/v2-proactivity-engine.ts`:
- Add imports near the top (alongside other service imports):
```ts
import { getEngagement, adaptiveThreshold } from './engagement/index.js';
import { isV2EngagementEnabled } from '../lib/feature-flags.js';
```
- In the `filterCandidates(userId, candidates)` method, BEFORE the loop that calls `gate3_Significance(c)`, compute the threshold once (best-effort):
```ts
    let sigThreshold = 0.6;
    if (isV2EngagementEnabled(userId)) {
      try {
        const eng = await getEngagement(userId, now);
        sigThreshold = adaptiveThreshold(0.6, eng.receptiveness);
      } catch (err) {
        console.warn('[engagement:gate3] failed:', err);
      }
    }
```
(If `now` is not in scope in `filterCandidates`, use `new Date()`.)
- Change the gate3 call from `if (!gate3_Significance(c)) continue;` to:
```ts
      if (!gate3_Significance(c, sigThreshold)) continue;
```

- [ ] **Step 5: Wire the reflector event threshold**

In `src/services/reflector-v2/index.ts`:
- Add imports:
```ts
import { significanceScore, EVENT_THRESHOLD } from './types.js';
import { getEngagement, adaptiveThreshold } from '../engagement/index.js';
import { isV2EngagementEnabled } from '../../lib/feature-flags.js';
```
(`significanceScore`/`EVENT_THRESHOLD` may already be re-exported via `export * from './types.js'` — import them explicitly here for use.)
- In `runEventCheck`, replace `if (!shouldFireEvent(facts)) return { emitted: false };` with an adaptive threshold:
```ts
    let thr = EVENT_THRESHOLD;
    if (isV2EngagementEnabled(userId)) {
      try {
        const eng = await getEngagement(userId, now);
        thr = adaptiveThreshold(EVENT_THRESHOLD, eng.receptiveness);
      } catch (err) {
        console.warn('[engagement:event] failed:', err);
      }
    }
    if (significanceScore(facts) < thr) return { emitted: false };
```
(Remove the now-unused `shouldFireEvent` import if it becomes unused, OR leave it — tsc will flag unused imports only if `noUnusedLocals` is on; check and remove if needed.)

- [ ] **Step 6: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/threshold-wiring.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. Also run `npx vitest run src/services/reflector-v2/ src/__integration__/v2-proactivity-flow.test.ts` to confirm no regression.

- [ ] **Step 7: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/lib/feature-flags.ts src/services/v2-proactivity-engine.ts \
  src/services/reflector-v2/index.ts src/services/engagement/threshold-wiring.test.ts
git commit -F - <<'EOF'
feat(v2-p2): adaptive significance threshold (gate3 + reflector event) (C1)

isV2EngagementEnabled flag. Proactivity gate3 and the Reflector v2 event
check use adaptiveThreshold(base, receptiveness) instead of the fixed 0.6 —
pester less when ignored, more when engaged. Best-effort, gated; off → 0.6.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C2: deliverTopInsight receptive-hour defer (critical bypass)

**Files:**
- Modify: `packages/server/src/services/insight-store.ts`
- Test: `packages/server/src/services/engagement/deliver-wiring.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/engagement/deliver-wiring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/insight-store.ts'), 'utf-8');

describe('deliverTopInsight receptive-hour defer', () => {
  it('imports engagement + flag', () => {
    expect(SRC).toMatch(/isV2EngagementEnabled/);
    expect(SRC).toMatch(/getEngagement/);
    expect(SRC).toMatch(/isReceptiveHour/);
  });
  it('defers non-critical outside the receptive hour (critical bypass)', () => {
    expect(SRC).toMatch(/severityBand|>= 8/);
    expect(SRC).toMatch(/isReceptiveHour\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/deliver-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the defer into deliverTopInsight**

In `src/services/insight-store.ts`:
- Add imports near the top:
```ts
import { getEngagement, isReceptiveHour } from './engagement/index.js';
import { isV2EngagementEnabled } from '../lib/feature-flags.js';
```
(`severityBand` is already exported from `insight-core.ts`; if not already imported here, add it to the existing `insight-core` import.)
- In `deliverTopInsight`, AFTER `const row = undelivered.find((r) => r.id === chosen.id)!;` and BEFORE the `deliverNotification(...)` call, add the receptive-hour gate:
```ts
  // v2 P2 — engagement: defer NON-critical delivery outside the user's
  // active hours. Critical (severity>=8) always delivers. Best-effort; on
  // any failure or sparse data, isReceptiveHour returns true → no deferral.
  if (isV2EngagementEnabled(userId) && severityBand(row.severity) !== 'critical') {
    try {
      const eng = await getEngagement(userId, now);
      if (!isReceptiveHour(eng.activeHours, hour)) {
        return { deliveredId: null }; // defer; next tick retries (deliveredAt stays null)
      }
    } catch (err) {
      console.warn('[engagement:deliver] failed:', err);
    }
  }
```
(`hour` and `row.severity` are already in scope from the existing function body.)

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/engagement/deliver-wiring.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/insight-store.ts src/services/engagement/deliver-wiring.test.ts
git commit -F - <<'EOF'
feat(v2-p2): receptive-hour delivery defer (C2)

deliverTopInsight defers non-critical pushes outside the user's active
hours (isReceptiveHour); critical (severity>=8) always delivers. Deferred
insights keep deliveredAt null → retried next tick until a receptive hour
or TTL. Best-effort, gated; sparse data → no deferral.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task E1: integration test + full verify + progress tracker

**Files:**
- Create: `packages/server/src/__integration__/v2-engagement-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

- [ ] **Step 1: Write the integration test (structural)**

Create `packages/server/src/__integration__/v2-engagement-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
const STORE = readFileSync(join(process.cwd(), 'src/services/insight-store.ts'), 'utf-8');
const REF = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const ENG = readFileSync(join(process.cwd(), 'src/services/engagement/engagement.ts'), 'utf-8');

describe('v2 engagement flow — adaptive threshold', () => {
  it('proactivity + reflector gate on adaptiveThreshold, flag-gated', () => {
    expect(ENGINE).toContain('adaptiveThreshold');
    expect(ENGINE).toContain('isV2EngagementEnabled');
    expect(REF).toContain('adaptiveThreshold');
  });
});

describe('v2 engagement flow — receptive-hour delivery', () => {
  it('deliverTopInsight defers non-critical outside active hours', () => {
    expect(STORE).toContain('isReceptiveHour');
    expect(STORE).toContain('isV2EngagementEnabled');
  });
});

describe('v2 engagement flow — degrade-safe, no new table', () => {
  it('getEngagement returns neutral on failure; reuses existing rows only', () => {
    expect(ENG).toMatch(/receptiveness: 0\.5/);
    expect(ENG).not.toMatch(/engagement\.create|prisma\.engagement/); // no new table
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/__integration__/v2-engagement-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run 2>&1 | tail -20
```
Expected: tsc clean; all tests pass (baseline 1776 + P2 ~30 ≈ 1806). `[...] failed:` / Prisma FK stderr lines are intentional best-effort logs, not failures — only the final summary matters. If any test genuinely FAILS, STOP and report BLOCKED.

- [ ] **Step 4: Update the progress tracker**

In `docs/plan/v2-memory-proactivity-scope.md`, add a "P2 — done" entry mirroring the Reflector/H2 entries: engagement-aware proactivity — adaptive significance threshold (gate3 + Reflector event) from recent receptiveness (InsightDismissal + deliveredAt + reply history) + receptive-hour delivery defer (ChatMessage active-hour histogram, critical bypass); no new table/migration; flag `isV2EngagementEnabled` (`FEATURE_V2_ENGAGEMENT`); degrade-safe to today's behavior; files `src/services/engagement/` (types, engagement, index) + wiring in v2-proactivity-engine + reflector-v2 + insight-store; ~6 tasks B1–E1. Match the doc's format.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/__integration__/v2-engagement-flow.test.ts \
  /Users/berikkurmangoliev/Desktop/LifeOS/docs/plan/v2-memory-proactivity-scope.md
git commit -F - <<'EOF'
test(v2-p2): engagement-flow integration + progress tracker (E1)

Structural integration: adaptive threshold in proactivity + reflector;
receptive-hour delivery defer in insight-store; getEngagement degrade-safe
and reuses existing rows (no new table). Marks P2 done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Rollout (AFTER all tasks green — explicit Berik approval per step)
1. **Push** (on "push"): `git push origin main`.
2. **Deploy**: NO migration. Verify Online (health 200).
3. **Flag**: `FEATURE_V2_ENGAGEMENT=user-cmp6n0jf90000pf017gv1kukz`.
4. **SMOKE** (subtle/timing — hard to force live): verify structurally + via logs that gate3 threshold + delivery-hour decisions reflect engagement. Data-thin caveat — watch over a few days. No regression to existing proactivity/Reflector delivery when flag is on but data sparse (neutral defaults).

---

## Self-Review (against the spec)
**Spec coverage:**
- §3.1 adaptive significance threshold → C1 (gate3 + reflector event) ✓
- §3.2 preferred active hour delivery → C2 (deliverTopInsight defer) ✓
- §4 components (types/engagement/index) → B1/B2/B3 ✓
- §5 wiring + flag → C1/C2 ✓
- §6 degrade-safe (neutral 0.5, critical bypass, no infinite-defer via TTL) → B2/C2 ✓
- §6 no new table → confirmed (no schema task); E1 asserts no new model ✓
- §7 testing (pure + structural + integration, zero vi.mock) → all ✓

**Placeholder scan:** none. The "if now not in scope use new Date()" / "remove unused import if needed" notes are explicit guards, not silent placeholders; concrete code provided.

**Type consistency:** `receptivenessScore(delivered,dismissed,repliedWithin)`, `adaptiveThreshold(base,receptiveness)`, `activeHourHistogram(hours)`, `isReceptiveHour(hist,hour,minShare?)` defined B1, used B2/C1/C2. `getEngagement(userId,now) → {receptiveness, activeHours}` B2 → C1/C2. `gate3_Significance(c, threshold)` consistent with the engine. `severityBand(sev)` reused in C2. `EVENT_THRESHOLD`/`significanceScore` reused in C1 reflector wiring.

**Total:** 6 tasks (B1–B3, C1, C2, E1). No schema/migration. Mirrors B1–B4 granularity.
```
