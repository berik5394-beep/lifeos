# v2.0 Week 5 — Proactivity Engine + 3 Agent Tools + Telegram /setname + jarvis-orchestrator + scheduler Wiring + Berik-only Rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the v2 ProactivityEngine (5 detectors → 4-gate filter → nudge generator → Insight delivery), 3 agent tools (`remember_entity`, `link_relationship`, `suggest_goal`), Telegram `/setname` command, **wire the v2 capture/enrichment path into `jarvis-orchestrator.ts`** (dual-write behind `isV2MemoryEnabled`), **wire the engine into `proactive-scheduler.ts`** (behind `isV2ProactivityEnabled`), and ship a **Berik-only rollout** at the end of the week.

**This is the FIRST week the bot's behavior changes.** Weeks 2-4 produced dead code in parallel. This week wires it in. Old chat pipeline preserved bit-identical when flags off; instant ENV-flip rollback.

**Stack/decisions locked (Berik 2026-05-31):**
- 3 agent tools only (no `suggest_task`/`suggest_event` — Week 6 or Phase B)
- Bot name default «Эля» (already in schema), `/setname` for changes (no onboarding flow)
- Cron tasks → Week 6 (NOT this week)
- Rollout end of Week 5: ONLY Berik (`FEATURE_V2_MEMORY=user-berikId`, `FEATURE_V2_PROACTIVITY=user-berikId`). Aydana → Week 7 after smoke.
- Zero `vi.mock`, zero schema changes, one atomic commit per task, `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- 17 atomic tasks: A1-A6 (engine), B1-B4 (tools+registry), C1 (telegram), D1-D3 (orchestrator wiring), E1 (scheduler wiring), F1 (rollout doc), G1 (final verify).

---

## Section A — `v2-proactivity-engine.ts` (6 tasks)

The engine is a single module with one class implementing the `ProactivityEngine` interface, 5 detectors (private functions), 4 gates (3 async + 1 pure), template-based nudge generator with Claude haiku fallback, and a singleton accessor. All Prisma I/O wrapped in best-effort try/catch — a failing detector never kills the whole tick. The four gates run **in this exact order**: DND → RateLimit → Significance → Dedup; first failure shortcircuits. Pure helpers (`scoreSignificance`, `gate3_Significance`, `interpolate`) are unit-tested without DB; everything async is covered by structural `readFileSync` greps mirroring Week 4 style (zero `vi.mock`).

### Task A1: Module skeleton + types + pure helpers + TEMPLATES

**Files:**
- Create: `packages/server/src/services/v2-proactivity-engine.ts`
- Create: `packages/server/src/services/v2-proactivity-engine.test.ts`

**Pure helpers to export (testable without DB):**
- `scoreSignificance(c: NudgeCandidate): number` — per-source scoring per spec §9.4; returns `0..1`
- `gate3_Significance(c: NudgeCandidate, threshold?: number): boolean` — `c.significance >= threshold` (default `0.6`)
- `interpolate(template: string, payload: Record<string, unknown>): string` — replaces `{{key}}` with `String(payload[key])`; missing keys → empty string (no throw)

- [ ] **Step 1: Write failing tests for helpers + structural skeleton**

Create `packages/server/src/services/v2-proactivity-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scoreSignificance,
  gate3_Significance,
  interpolate,
  TEMPLATES,
} from './v2-proactivity-engine.js';
import type { NudgeCandidate } from './v2-proactivity-engine.js';

const SRC = readFileSync(
  join(__dirname, 'v2-proactivity-engine.ts'),
  'utf8',
);

describe('scoreSignificance — pure', () => {
  it('stale_entity scales by gapRatio and importance', () => {
    const c: NudgeCandidate = {
      source: 'stale_entity',
      significance: 0,
      payload: { gapRatio: 5, importance: 10 },
      toneHint: 'gentle',
    };
    expect(scoreSignificance(c)).toBe(1);
  });

  it('stale_entity defaults importance=5 when missing', () => {
    const c: NudgeCandidate = {
      source: 'stale_entity',
      significance: 0,
      payload: { gapRatio: 10 },
      toneHint: 'gentle',
    };
    // (10/5) * (5/10) = 1
    expect(scoreSignificance(c)).toBe(1);
  });

  it('commitment_due grows with daysOverdue and caps at 1', () => {
    expect(
      scoreSignificance({
        source: 'commitment_due',
        significance: 0,
        payload: { daysOverdue: 0 },
        toneHint: 'curious',
      }),
    ).toBe(0.5);
    expect(
      scoreSignificance({
        source: 'commitment_due',
        significance: 0,
        payload: { daysOverdue: 14 },
        toneHint: 'curious',
      }),
    ).toBe(1);
  });

  it('mood_shift uses |magnitude|', () => {
    expect(
      scoreSignificance({
        source: 'mood_shift',
        significance: 0,
        payload: { magnitude: -0.8 },
        toneHint: 'supportive',
      }),
    ).toBe(0.8);
  });

  it('streak_break = consistency * 0.8', () => {
    expect(
      scoreSignificance({
        source: 'streak_break',
        significance: 0,
        payload: { consistency: 1 },
        toneHint: 'gentle',
      }),
    ).toBe(0.8);
  });

  it('goal_no_progress scales daysSilent / 14', () => {
    expect(
      scoreSignificance({
        source: 'goal_no_progress',
        significance: 0,
        payload: { daysSilent: 7 },
        toneHint: 'curious',
      }),
    ).toBe(0.5);
  });
});

describe('gate3_Significance — pure', () => {
  const base = (s: number): NudgeCandidate => ({
    source: 'stale_entity',
    significance: s,
    payload: {},
    toneHint: 'gentle',
  });
  it('passes >=0.6 by default', () => {
    expect(gate3_Significance(base(0.6))).toBe(true);
    expect(gate3_Significance(base(0.59))).toBe(false);
  });
  it('honours custom threshold', () => {
    expect(gate3_Significance(base(0.4), 0.3)).toBe(true);
    expect(gate3_Significance(base(0.2), 0.3)).toBe(false);
  });
});

describe('interpolate — pure', () => {
  it('replaces {{key}} occurrences', () => {
    expect(interpolate('Hi {{name}}!', { name: 'Берик' })).toBe('Hi Берик!');
  });
  it('repeats same key', () => {
    expect(interpolate('{{x}}-{{x}}', { x: 1 })).toBe('1-1');
  });
  it('missing key → empty string (no throw)', () => {
    expect(interpolate('a={{a}} b={{b}}', { a: 'A' })).toBe('a=A b=');
  });
  it('passes string through when no placeholders', () => {
    expect(interpolate('plain', { x: 1 })).toBe('plain');
  });
});

describe('TEMPLATES — table', () => {
  it('covers all 5 sources', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(
      [
        'commitment_due',
        'goal_no_progress',
        'mood_shift',
        'stale_entity',
        'streak_break',
      ].sort(),
    );
  });
  it('each source has at least one tone template', () => {
    for (const src of Object.values(TEMPLATES)) {
      expect(Object.keys(src).length).toBeGreaterThan(0);
    }
  });
});

describe('structural — module skeleton', () => {
  it('exports ProactivityEngine interface', () => {
    expect(SRC).toMatch(/export interface ProactivityEngine\b/);
  });
  it('exports NudgeCandidate type', () => {
    expect(SRC).toMatch(/export type NudgeCandidate\s*=/);
  });
  it('declares runForUser, detectCandidates, filterCandidates, generateNudge', () => {
    for (const m of [
      'runForUser',
      'detectCandidates',
      'filterCandidates',
      'generateNudge',
    ]) {
      expect(SRC).toMatch(new RegExp(`\\b${m}\\b`));
    }
  });
  it('placeholders throw with "not yet implemented" marker', () => {
    expect(SRC).toMatch(/not yet implemented — Task A/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement skeleton + helpers + TEMPLATES**

Create `packages/server/src/services/v2-proactivity-engine.ts`:

```typescript
/**
 * v2.0 Week 5 — Proactivity Engine.
 *
 * Single source of truth for outbound proactive nudges based on the new
 * memory tiers (semantic / episodic / procedural / emotional). Runs per
 * scheduler tick (every 10 min, behind FEATURE_V2_PROACTIVITY flag).
 *
 * Flow: runForUser → detectCandidates (5 detectors) → filterCandidates
 * (4 gates in order: DND, RateLimit, Significance, Dedup) → pick top by
 * significance → generateNudge (template lookup → Claude haiku fallback)
 * → deliverTopInsight (existing R6 push pipeline).
 *
 * All detectors and gates are best-effort: a thrown error in one detector
 * never kills the tick (Promise.allSettled / per-detector try/catch).
 */

// ---- Public types ---------------------------------------------------------

export type NudgeSource =
  | 'stale_entity'
  | 'commitment_due'
  | 'mood_shift'
  | 'streak_break'
  | 'goal_no_progress';

export type NudgeTone = 'gentle' | 'curious' | 'supportive' | 'celebratory';

export type NudgeCandidate = {
  source: NudgeSource;
  significance: number; // 0..1
  entityId?: string;
  patternId?: string;
  payload: Record<string, unknown>;
  toneHint: NudgeTone;
};

export interface ProactivityEngine {
  runForUser(userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }>;
  detectCandidates(userId: string): Promise<NudgeCandidate[]>;
  filterCandidates(
    userId: string,
    candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]>;
  generateNudge(userId: string, candidate: NudgeCandidate): Promise<string>;
}

// ---- Pure helpers ---------------------------------------------------------

export function scoreSignificance(c: NudgeCandidate): number {
  switch (c.source) {
    case 'stale_entity': {
      const gapRatio = Number(c.payload.gapRatio ?? 0);
      const importance = Number(c.payload.importance ?? 5);
      return Math.min(1, (gapRatio / 5) * (importance / 10));
    }
    case 'commitment_due': {
      const daysOverdue = Number(c.payload.daysOverdue ?? 0);
      return Math.min(1, 0.5 + daysOverdue / 14);
    }
    case 'mood_shift': {
      const magnitude = Math.abs(Number(c.payload.magnitude ?? 0));
      return Math.min(1, magnitude);
    }
    case 'streak_break': {
      const consistency = Number(c.payload.consistency ?? 0);
      return Math.max(0, Math.min(1, consistency * 0.8));
    }
    case 'goal_no_progress': {
      const daysSilent = Number(c.payload.daysSilent ?? 0);
      return Math.min(1, daysSilent / 14);
    }
  }
}

export function gate3_Significance(
  c: NudgeCandidate,
  threshold = 0.6,
): boolean {
  return c.significance >= threshold;
}

export function interpolate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = payload[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// ---- Templates ------------------------------------------------------------
// Keep small/safe — Claude fallback handles long-tail tone/personalisation.

export const TEMPLATES: Record<NudgeSource, Partial<Record<NudgeTone, string>>> = {
  stale_entity: {
    gentle:
      'Слушай, давно ничего не было про {{name}} — как там у вас? Прошло {{daysSinceLast}} дней.',
    curious:
      'Кстати, {{name}} — что нового? Обычно вы пересекаетесь чаще.',
    supportive:
      'Помню, в последний раз с {{name}} было непросто. Как сейчас?',
  },
  commitment_due: {
    gentle:
      'Ты обещал «{{commitment}}» — прошло {{daysOverdue}} дней. Получилось?',
    curious: 'Как там «{{commitment}}»? Уже {{daysOverdue}} дней прошло.',
  },
  mood_shift: {
    supportive:
      'Замечаю, настроение последние дни ушло в минус. Хочешь — поговорим?',
    gentle: 'Кажется, неделя была тяжёлой. Как ты сейчас?',
  },
  streak_break: {
    gentle:
      'Цепочка по «{{habit}}» прервалась — это окей, не обязан сегодня. Просто отмечаю.',
    celebratory:
      'Помню, ты держал «{{habit}}» долго — захочешь подхватить, я рядом.',
  },
  goal_no_progress: {
    curious:
      'Цель «{{goal}}» — тишина уже {{daysSilent}} дней. Цель ещё актуальна?',
    gentle:
      'Давно не двигали «{{goal}}». Скорректировать или отпустить?',
  },
};

// ---- Engine class — placeholders (filled in A2-A6) -----------------------

export class V2ProactivityEngine implements ProactivityEngine {
  async runForUser(_userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }> {
    throw new Error('not yet implemented — Task A6');
  }
  async detectCandidates(_userId: string): Promise<NudgeCandidate[]> {
    throw new Error('not yet implemented — Task A2/A3');
  }
  async filterCandidates(
    _userId: string,
    _candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]> {
    throw new Error('not yet implemented — Task A4');
  }
  async generateNudge(
    _userId: string,
    _candidate: NudgeCandidate,
  ): Promise<string> {
    throw new Error('not yet implemented — Task A5');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: tsc + vi.mock guard**
```bash
cd packages/server
npx tsc --noEmit
grep -n "vi\.mock" src/services/v2-proactivity-engine.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): scaffold engine — types, pure helpers, TEMPLATES (A1)

Public ProactivityEngine interface + NudgeCandidate type. Pure helpers
scoreSignificance / gate3_Significance / interpolate covered by unit
tests; engine methods throw 'not yet implemented' until A2-A6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Detectors — `detectStaleEntity` + `detectCommitmentDue`

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts`

**Detectors (private module-scope functions):**
- `detectStaleEntity(userId)` — `getEntityGraph().staleEntities({ sinceDays: 7, minImportance: 5 })` → for each, `lastEventForEntity(userId, entityId)` and `getProceduralMemory().getActivePatterns(userId, { kind: 'frequency', entityId })` → compute `gapRatio = actualGap / pattern.periodDays`; emit candidate when `gapRatio >= 1.5`.
- `detectCommitmentDue(userId)` — `getProceduralMemory().getActivePatterns(userId, { kind: 'commitment' })` filter `meta.dueAt < now`; `daysOverdue = floor((now - dueAt) / 86_400_000)`.

Each wrapped in its own try/catch; on throw returns `[]` + `console.warn`.

- [ ] **Step 1: Write failing structural tests**

Append to `v2-proactivity-engine.test.ts`:

```typescript
describe('structural — A2 detectors', () => {
  it('imports getEntityGraph and getProceduralMemory', () => {
    expect(SRC).toMatch(/from '\.\/entity-graph\/index\.js'/);
    expect(SRC).toMatch(/from '\.\/procedural-memory\.singleton\.js'/);
  });
  it('defines detectStaleEntity', () => {
    expect(SRC).toMatch(/function detectStaleEntity\s*\(/);
    expect(SRC).toMatch(/staleEntities\(\s*userId\s*,/);
    expect(SRC).toMatch(/sinceDays:\s*7/);
    expect(SRC).toMatch(/minImportance:\s*5/);
  });
  it('defines detectCommitmentDue with overdue calc', () => {
    expect(SRC).toMatch(/function detectCommitmentDue\s*\(/);
    expect(SRC).toMatch(/daysOverdue/);
  });
  it('each detector is wrapped in try/catch returning []', () => {
    // crude: count "return []" within ~50 chars of "catch" — two detectors
    const matches = SRC.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,120}?return\s*\[\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: FAIL — detectors missing.

- [ ] **Step 3: Implement detectors**

Add to `v2-proactivity-engine.ts` (above the class):

```typescript
import { getEntityGraph } from './entity-graph/index.js';
import { getProceduralMemory } from './procedural-memory.singleton.js';
import { lastEventForEntity } from './episodic-memory.js';

const DAY_MS = 86_400_000;

async function detectStaleEntity(userId: string): Promise<NudgeCandidate[]> {
  try {
    const graph = getEntityGraph();
    const procedural = getProceduralMemory();
    const stale = await graph.staleEntities(userId, {
      sinceDays: 7,
      minImportance: 5,
    });
    const out: NudgeCandidate[] = [];
    const now = Date.now();
    for (const ent of stale) {
      const last = await lastEventForEntity(userId, ent.id).catch(() => null);
      const lastAt = last?.occurredAt?.getTime() ?? ent.lastSeenAt?.getTime() ?? now;
      const daysSinceLast = Math.max(1, Math.floor((now - lastAt) / DAY_MS));
      const patterns = await procedural
        .getActivePatterns(userId, { kind: 'frequency', entityId: ent.id })
        .catch(() => []);
      const period = Number(patterns[0]?.meta?.periodDays ?? 0);
      if (period <= 0) continue;
      const gapRatio = daysSinceLast / period;
      if (gapRatio < 1.5) continue;
      const cand: NudgeCandidate = {
        source: 'stale_entity',
        significance: 0,
        entityId: ent.id,
        patternId: patterns[0]?.id,
        payload: {
          name: ent.name,
          daysSinceLast,
          gapRatio,
          importance: ent.importance,
        },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectStaleEntity failed:', err);
    return [];
  }
}

async function detectCommitmentDue(userId: string): Promise<NudgeCandidate[]> {
  try {
    const procedural = getProceduralMemory();
    const patterns = await procedural.getActivePatterns(userId, {
      kind: 'commitment',
    });
    const now = Date.now();
    const out: NudgeCandidate[] = [];
    for (const p of patterns) {
      const meta = (p.meta ?? {}) as Record<string, unknown>;
      const dueAt = meta.dueAt ? new Date(String(meta.dueAt)).getTime() : NaN;
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      const daysOverdue = Math.max(0, Math.floor((now - dueAt) / DAY_MS));
      const cand: NudgeCandidate = {
        source: 'commitment_due',
        significance: 0,
        patternId: p.id,
        entityId: (meta.entityId as string) ?? undefined,
        payload: {
          commitment: String(meta.text ?? ''),
          daysOverdue,
        },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectCommitmentDue failed:', err);
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc**
```bash
cd packages/server
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): detectors detectStaleEntity + detectCommitmentDue (A2)

Stale: entities idle > 1.5× pattern period (importance >= 5). Commitment:
procedural patterns kind='commitment' past meta.dueAt. Both best-effort
with per-detector try/catch — failure returns [] not throws.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Detectors — `detectMoodShift` + `detectStreakBreak` + `detectGoalNoProgress`

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts`

**Detectors:**
- `detectMoodShift(userId)` — `getEmotionalMemory().detectMoodShift(userId)` returns `{ magnitude, baseline, recent } | null`; emit one candidate when `Math.abs(magnitude) >= 0.4`.
- `detectStreakBreak(userId)` — query Prisma `habit` rows + their `habitCompletion` last 7 days; for each habit with `getActivePatterns({kind:'streak_break', entityId: habit.id})` returning a pattern, emit if no completion in last 2 days. `consistency` from `pattern.confidence`.
- `detectGoalNoProgress(userId)` — `YearlyGoal.findMany({ userId, archived: false })`; for each, query latest `Task` or `Memory` referencing goal in `tags`; if `>= 14` days silent, emit.

- [ ] **Step 1: Write failing tests**

Append to `v2-proactivity-engine.test.ts`:

```typescript
describe('structural — A3 detectors', () => {
  it('defines detectMoodShift importing emotional-memory singleton', () => {
    expect(SRC).toMatch(/from '\.\/emotional-memory\.singleton\.js'/);
    expect(SRC).toMatch(/function detectMoodShift\s*\(/);
    expect(SRC).toMatch(/detectMoodShift\(userId\)/);
  });
  it('defines detectStreakBreak using prisma', () => {
    expect(SRC).toMatch(/function detectStreakBreak\s*\(/);
    expect(SRC).toMatch(/habitCompletion|HabitCompletion/);
  });
  it('defines detectGoalNoProgress reading YearlyGoal', () => {
    expect(SRC).toMatch(/function detectGoalNoProgress\s*\(/);
    expect(SRC).toMatch(/yearlyGoal\.findMany/);
  });
  it('all 5 detectors are wrapped in try/catch', () => {
    const matches = SRC.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,160}?return\s*\[\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: FAIL — three detectors missing.

- [ ] **Step 3: Implement the three detectors**

Add imports near the top:

```typescript
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import { prisma } from '../lib/prisma.js';
```

Add functions:

```typescript
async function detectMoodShift(userId: string): Promise<NudgeCandidate[]> {
  try {
    const emotional = getEmotionalMemory();
    const shift = await emotional.detectMoodShift(userId);
    if (!shift) return [];
    const magnitude = Number(shift.magnitude ?? 0);
    if (Math.abs(magnitude) < 0.4) return [];
    const cand: NudgeCandidate = {
      source: 'mood_shift',
      significance: 0,
      payload: {
        magnitude,
        baseline: shift.baseline,
        recent: shift.recent,
      },
      toneHint: magnitude < 0 ? 'supportive' : 'celebratory',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectMoodShift failed:', err);
    return [];
  }
}

async function detectStreakBreak(userId: string): Promise<NudgeCandidate[]> {
  try {
    const procedural = getProceduralMemory();
    const habits = await prisma.habit.findMany({
      where: { userId, archived: false },
      select: { id: true, name: true },
    });
    if (habits.length === 0) return [];
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
    const recent = await prisma.habitCompletion.findMany({
      where: {
        habitId: { in: habits.map((h) => h.id) },
        completedAt: { gte: twoDaysAgo },
      },
      select: { habitId: true },
    });
    const activeIds = new Set(recent.map((r) => r.habitId));
    const out: NudgeCandidate[] = [];
    for (const h of habits) {
      if (activeIds.has(h.id)) continue;
      const patterns = await procedural
        .getActivePatterns(userId, { kind: 'streak_break', entityId: h.id })
        .catch(() => []);
      if (patterns.length === 0) continue;
      const consistency = Number(patterns[0]?.confidence ?? 0);
      const cand: NudgeCandidate = {
        source: 'streak_break',
        significance: 0,
        patternId: patterns[0].id,
        entityId: h.id,
        payload: { habit: h.name, consistency },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectStreakBreak failed:', err);
    return [];
  }
}

async function detectGoalNoProgress(userId: string): Promise<NudgeCandidate[]> {
  try {
    const goals = await prisma.yearlyGoal.findMany({
      where: { userId, archived: false },
      select: { id: true, goal: true, updatedAt: true },
    });
    if (goals.length === 0) return [];
    const now = Date.now();
    const out: NudgeCandidate[] = [];
    for (const g of goals) {
      const lastAt = g.updatedAt?.getTime() ?? 0;
      const daysSilent = Math.floor((now - lastAt) / DAY_MS);
      if (daysSilent < 14) continue;
      const cand: NudgeCandidate = {
        source: 'goal_no_progress',
        significance: 0,
        payload: { goal: g.goal, daysSilent },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectGoalNoProgress failed:', err);
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc**
```bash
cd packages/server
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): detectors moodShift + streakBreak + goalNoProgress (A3)

MoodShift via emotional-memory.detectMoodShift (|mag|>=0.4). StreakBreak
via habitCompletion gap+pattern lookup. GoalNoProgress via YearlyGoal
updatedAt >=14d. All best-effort, isolated try/catch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Four gates + `filterCandidates` orchestrator

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts`

**Gates:** ordered DND → RateLimit → Significance → Dedup. First three are user-scoped (apply once per call). Dedup is per-candidate. Significance is pure (already from A1).

`gate1_DND` — reuses existing `isInDNDWindow` from `services/proactive-notifications.ts` (it already implements the quiet-hours check used by R11). If that helper isn't exported, fall back to direct query: `prisma.user.findUnique({ select: { quietStart, quietEnd, timezone } })` + `localHour`.

`gate2_RateLimit` — `prisma.insight.count` where `source='v2-proactivity'` and `createdAt >= localDayStartUTC(tz, now)`. Cap = 2/day.

`gate4_Dedup` — `prisma.insight.findFirst` last 7 days where `metadata->>'entityId' = candidate.entityId`. If `candidate.entityId` is undefined → skip dedup (pass).

- [ ] **Step 1: Write failing tests**

Append to `v2-proactivity-engine.test.ts`:

```typescript
describe('structural — A4 gates + filterCandidates', () => {
  it('exports/uses 4 gates in correct order', () => {
    expect(SRC).toMatch(/function gate1_DND\s*\(/);
    expect(SRC).toMatch(/function gate2_RateLimit\s*\(/);
    // gate3_Significance already exported (A1)
    expect(SRC).toMatch(/function gate4_Dedup\s*\(/);
    // order: DND must appear before RateLimit appear before Significance
    // appear before Dedup inside filterCandidates body
    const body = SRC.slice(SRC.indexOf('filterCandidates'));
    expect(body.indexOf('gate1_DND')).toBeLessThan(body.indexOf('gate2_RateLimit'));
    expect(body.indexOf('gate2_RateLimit')).toBeLessThan(body.indexOf('gate3_Significance'));
    expect(body.indexOf('gate3_Significance')).toBeLessThan(body.indexOf('gate4_Dedup'));
  });
  it('gate2 caps at 2/day with source filter', () => {
    expect(SRC).toMatch(/source:\s*'v2-proactivity'/);
    expect(SRC).toMatch(/<\s*2\b|todayCount\s*<\s*2/);
  });
  it('gate4 uses 7-day window on metadata.entityId', () => {
    expect(SRC).toMatch(/path:\s*\['entityId'\]/);
    expect(SRC).toMatch(/7\s*\*\s*DAY_MS|subDays\(\s*\w+\s*,\s*7\s*\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement gates + filterCandidates (replace class method)**

Add imports if missing:

```typescript
import { localDayStartUTC, localHour } from '../lib/tz.js';
```

Add gate functions:

```typescript
async function gate1_DND(userId: string, now: Date): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, wakeUpTime: true },
    });
    if (!u) return false;
    const hour = localHour(u.timezone, now);
    const wakeUpHour = Number(String(u.wakeUpTime).split(':')[0]) || 7;
    // Quiet: from 22:00 until wakeUpHour the next morning.
    if (hour >= 22 || hour < wakeUpHour) return false;
    return true;
  } catch (err) {
    console.warn('[v2-proactivity] gate1_DND failed:', err);
    return false; // fail-closed: when in doubt, do not nudge
  }
}

async function gate2_RateLimit(userId: string, now: Date): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!u) return false;
    const dayStart = localDayStartUTC(u.timezone, now);
    const todayCount = await prisma.insight.count({
      where: {
        userId,
        source: 'v2-proactivity',
        createdAt: { gte: dayStart },
      },
    });
    return todayCount < 2;
  } catch (err) {
    console.warn('[v2-proactivity] gate2_RateLimit failed:', err);
    return false;
  }
}

async function gate4_Dedup(
  userId: string,
  candidate: NudgeCandidate,
  now: Date,
): Promise<boolean> {
  if (!candidate.entityId) return true;
  try {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const recent = await prisma.insight.findFirst({
      where: {
        userId,
        source: 'v2-proactivity',
        metadata: { path: ['entityId'], equals: candidate.entityId },
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    return recent === null;
  } catch (err) {
    console.warn('[v2-proactivity] gate4_Dedup failed:', err);
    return false;
  }
}
```

Replace `filterCandidates` method in `V2ProactivityEngine`:

```typescript
  async filterCandidates(
    userId: string,
    candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]> {
    if (candidates.length === 0) return [];
    const now = new Date();
    // Gate 1 + 2 are user-scoped, shortcircuit early.
    if (!(await gate1_DND(userId, now))) return [];
    if (!(await gate2_RateLimit(userId, now))) return [];
    const passed: NudgeCandidate[] = [];
    for (const c of candidates) {
      if (!gate3_Significance(c)) continue;
      if (!(await gate4_Dedup(userId, c, now))) continue;
      passed.push(c);
    }
    return passed;
  }
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc**
```bash
cd packages/server
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): 4-gate filter + filterCandidates orchestrator (A4)

Order: DND (quiet hours by user tz) → RateLimit (<2/day, source-scoped)
→ Significance (>=0.6) → Dedup (no same entity nudge in last 7d). User
gates fail-closed: any error → skip nudge. Spec §9.3 verbatim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: `generateNudge` — template + Claude haiku fallback

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts`

**Behaviour:**
1. `TEMPLATES[source][toneHint]` exists → `interpolate(template, payload)` and return immediately.
2. Else → Claude haiku via existing `runAgent` from `services/claude-agent.ts` with `webSearch:false`, `localTools:false`. Prompt includes the bot identity (`getBotIdentityService().getIdentity(userId)`) so the nudge sounds like the user-named bot.
3. Any throw from runAgent → fall back to a safe generic line (`'Подумал о тебе — как ты?'`).

- [ ] **Step 1: Write failing tests**

Append:

```typescript
describe('structural — A5 generateNudge', () => {
  it('imports runAgent + getBotIdentityService', () => {
    expect(SRC).toMatch(/from '\.\/claude-agent\.js'/);
    expect(SRC).toMatch(/from '\.\/bot-identity\.singleton\.js'/);
  });
  it('looks up TEMPLATES[source][toneHint] before fallback', () => {
    const body = SRC.slice(SRC.indexOf('generateNudge'));
    expect(body.indexOf('TEMPLATES[')).toBeLessThan(body.indexOf('runAgent('));
  });
  it('uses interpolate on the template', () => {
    expect(SRC).toMatch(/interpolate\(\s*template/);
  });
  it('has a safe fallback string when Claude fails', () => {
    expect(SRC).toMatch(/Подумал о тебе — как ты\?/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement generateNudge**

Add imports:

```typescript
import { runAgent } from './claude-agent.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
```

Replace `generateNudge`:

```typescript
  async generateNudge(
    userId: string,
    candidate: NudgeCandidate,
  ): Promise<string> {
    // 1) Template lookup — fast, deterministic, free.
    const template = TEMPLATES[candidate.source]?.[candidate.toneHint];
    if (template) {
      const rendered = interpolate(template, candidate.payload);
      if (rendered.trim().length > 0) return rendered;
    }
    // 2) Claude haiku fallback.
    try {
      const identity = await getBotIdentityService()
        .getIdentity(userId)
        .catch(() => null);
      const botName = identity?.botName ?? 'JARVIS';
      const tone = candidate.toneHint;
      const prompt =
        `Ты — ${botName}, проактивный AI-друг. Сгенерируй ОДНО короткое ` +
        `(1-2 предложения, без markdown, без emoji кроме 🤍) ` +
        `проактивное сообщение пользователю. Tone: ${tone}. ` +
        `Source: ${candidate.source}. Payload: ${JSON.stringify(candidate.payload)}. ` +
        `Не объясняй, не извиняйся — просто сообщение, как другу.`;
      const reply = await runAgent({
        system: prompt,
        userMessage: 'Generate.',
        webSearch: false,
        localTools: false,
        maxTokens: 200,
        userId,
      });
      const txt = (reply ?? '').trim();
      if (txt.length > 0) return txt;
    } catch (err) {
      console.warn('[v2-proactivity] generateNudge claude failed:', err);
    }
    return 'Подумал о тебе — как ты?';
  }
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc**
```bash
cd packages/server
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): generateNudge template-first + Claude haiku fallback (A5)

TEMPLATES[source][toneHint] → interpolate. Miss → runAgent with bot
identity (botName) injected, webSearch/localTools off, maxTokens 200.
Any throw → safe generic line so engine never crashes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: `runForUser` orchestrator + singleton

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts`
- Create: `packages/server/src/services/v2-proactivity-engine.singleton.ts`
- Create: `packages/server/src/services/v2-proactivity-engine.singleton.test.ts`

**`detectCandidates`** — runs all 5 detectors via `Promise.allSettled`, flattens fulfilled `value`s.

**`runForUser`** — `detectCandidates` → `filterCandidates` → sort desc by `significance` → take top 1 → `generateNudge` → persist as `Insight` via `persistCandidates` from `insight-store.ts` with `source: 'v2-proactivity'`, `kind: 'v2_nudge'`, `scope: candidate.source + ':' + (candidate.entityId ?? candidate.patternId ?? 'global')`, `metadata: { entityId, patternId, payload }` → on the SAME tick the parent scheduler will call `deliverTopInsight` (already in tick loop after E1 hook is irrelevant — insight is pushed via existing R6 path). Returns the counts.

- [ ] **Step 1: Write failing tests**

Append to `v2-proactivity-engine.test.ts`:

```typescript
describe('structural — A6 runForUser + detectCandidates orchestrator', () => {
  it('detectCandidates uses Promise.allSettled over the 5 detectors', () => {
    expect(SRC).toMatch(/Promise\.allSettled/);
    for (const fn of [
      'detectStaleEntity',
      'detectCommitmentDue',
      'detectMoodShift',
      'detectStreakBreak',
      'detectGoalNoProgress',
    ]) {
      expect(SRC).toMatch(new RegExp(`${fn}\\(\\s*userId\\s*\\)`));
    }
  });
  it('runForUser sorts by significance desc and takes top 1', () => {
    const body = SRC.slice(SRC.indexOf('runForUser'));
    expect(body).toMatch(/\.sort\(/);
    expect(body).toMatch(/significance/);
  });
  it('persists via persistCandidates with source v2-proactivity', () => {
    expect(SRC).toMatch(/from '\.\/insight-store\.js'/);
    expect(SRC).toMatch(/persistCandidates\(/);
    expect(SRC).toMatch(/source:\s*'v2-proactivity'/);
  });
  it('returns three-counter result object', () => {
    expect(SRC).toMatch(/candidatesFound/);
    expect(SRC).toMatch(/candidatesAfterFilter/);
    expect(SRC).toMatch(/nudgesDelivered/);
  });
});
```

Create `packages/server/src/services/v2-proactivity-engine.singleton.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getProactivityEngine,
  _resetProactivityEngineForTests,
} from './v2-proactivity-engine.singleton.js';
import { V2ProactivityEngine } from './v2-proactivity-engine.js';

describe('proactivity-engine singleton', () => {
  it('returns the same instance across calls', () => {
    _resetProactivityEngineForTests();
    const a = getProactivityEngine();
    const b = getProactivityEngine();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(V2ProactivityEngine);
  });
  it('reset replaces the instance', () => {
    const a = getProactivityEngine();
    _resetProactivityEngineForTests();
    const b = getProactivityEngine();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine
```
Expected: FAIL.

- [ ] **Step 3: Implement orchestrator + singleton**

In `v2-proactivity-engine.ts`, add import:

```typescript
import { persistCandidates } from './insight-store.js';
import type { InsightCandidate } from './insight-core.js';
```

Replace `detectCandidates` + `runForUser`:

```typescript
  async detectCandidates(userId: string): Promise<NudgeCandidate[]> {
    const results = await Promise.allSettled([
      detectStaleEntity(userId),
      detectCommitmentDue(userId),
      detectMoodShift(userId),
      detectStreakBreak(userId),
      detectGoalNoProgress(userId),
    ]);
    const out: NudgeCandidate[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
    return out;
  }

  async runForUser(userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }> {
    const all = await this.detectCandidates(userId);
    const passed = await this.filterCandidates(userId, all);
    if (passed.length === 0) {
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: 0,
        nudgesDelivered: 0,
      };
    }
    passed.sort((a, b) => b.significance - a.significance);
    const top = passed[0];
    const message = await this.generateNudge(userId, top);
    const scope =
      `${top.source}:${top.entityId ?? top.patternId ?? 'global'}`;
    const candidate: InsightCandidate = {
      kind: 'v2_nudge',
      scope,
      source: 'v2-proactivity',
      severity: Math.round(top.significance * 10),
      message,
      rationale: `v2-proactivity:${top.source}`,
      metadata: {
        entityId: top.entityId,
        patternId: top.patternId,
        payload: top.payload,
        toneHint: top.toneHint,
      },
    };
    try {
      const res = await persistCandidates(userId, [candidate]);
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: passed.length,
        nudgesDelivered: res.created,
      };
    } catch (err) {
      console.warn('[v2-proactivity] persistCandidates failed:', err);
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: passed.length,
        nudgesDelivered: 0,
      };
    }
  }
```

Create `packages/server/src/services/v2-proactivity-engine.singleton.ts`:

```typescript
/**
 * v2.0 Week 5 — singleton accessor for ProactivityEngine.
 * Mirrors procedural-memory.singleton.ts. Wired from proactive-scheduler
 * (E1) behind isV2ProactivityEnabled flag.
 */
import { V2ProactivityEngine } from './v2-proactivity-engine.js';
import type { ProactivityEngine } from './v2-proactivity-engine.js';

let _instance: ProactivityEngine | null = null;

export function getProactivityEngine(): ProactivityEngine {
  if (!_instance) _instance = new V2ProactivityEngine();
  return _instance;
}

export function _resetProactivityEngineForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- --reporter=verbose src/services/v2-proactivity-engine
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
grep -rn "vi\.mock" src/services/v2-proactivity-engine*.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts packages/server/src/services/v2-proactivity-engine.singleton.ts packages/server/src/services/v2-proactivity-engine.singleton.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-proactivity): runForUser orchestrator + singleton (A6)

detectCandidates fans out via Promise.allSettled — one bad detector
doesn't kill the tick. runForUser picks top by significance, persists
as Insight source='v2-proactivity' kind='v2_nudge' so existing R6
deliverTopInsight pushes it on the same tick. Singleton mirrors
procedural-memory pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section B — 3 Agent Tools + Registry (4 tasks)

Three new tools land in the existing SSOT registry (`tools/index.ts`). All `category: 'memory'` except `suggest_goal` which is `'task'` (no `goal` category exists today — mirror Week 4 convention of only adding registry rows when the category enum is already in `_types.ts`; reusing `'task'` for goal-suggestions keeps the enum stable). `remember_entity` and `link_relationship` are `needsConfirm: false` (memory writes are reversible and the user explicitly asked the bot to remember). `suggest_goal` is `needsConfirm: true` — creating a `YearlyGoal` is a year-shaping commitment, must go through the existing confirm-FSM path (security invariant: `agentToolSchemas` filter auto-excludes it from the autonomous loop).

### Task B1: `remember-entity.ts` tool + test

**Files:**
- Create: `packages/server/src/tools/remember-entity.ts`
- Create: `packages/server/src/tools/remember-entity.test.ts`

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/tools/remember-entity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rememberEntityTool } from './remember-entity.js';

const SRC = readFileSync(join(__dirname, 'remember-entity.ts'), 'utf8');

describe('rememberEntityTool — shape', () => {
  it('name = remember_entity, category memory, write, no confirm', () => {
    expect(rememberEntityTool.name).toBe('remember_entity');
    expect(rememberEntityTool.category).toBe('memory');
    expect(rememberEntityTool.sideEffects).toBe('write');
    expect(rememberEntityTool.needsConfirm).toBe(false);
  });
  it('schema accepts valid input', () => {
    expect(() =>
      rememberEntityTool.schema.parse({
        type: 'person',
        name: 'мама',
        importance: 9,
      }),
    ).not.toThrow();
  });
  it('schema rejects unknown type', () => {
    expect(() =>
      rememberEntityTool.schema.parse({ type: 'animal', name: 'x' }),
    ).toThrow();
  });
  it('schema rejects importance out of [1,10]', () => {
    expect(() =>
      rememberEntityTool.schema.parse({
        type: 'person',
        name: 'a',
        importance: 11,
      }),
    ).toThrow();
  });
  it('handler delegates to getEntityGraph().upsertEntity', () => {
    expect(SRC).toMatch(/getEntityGraph\(\)\.upsertEntity/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/tools/remember-entity.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement tool**

Create `packages/server/src/tools/remember-entity.ts`:

```typescript
import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * v2.0 Week 5 — agent-callable memory tool. Lets the bot persist a new
 * entity (person/place/concept/goal/org) explicitly: «запомни маму» or
 * after relationship extraction inside a conversation. Reversible
 * (upsert is idempotent on canonical name) → needsConfirm:false.
 */
export const rememberEntityTool = defineTool({
  name: 'remember_entity',
  description:
    'Запомнить (или обновить) entity в долгосрочной памяти юзера: ' +
    'человека, место, концепцию, цель, организацию. Вызывай когда юзер ' +
    'явно просит «запомни X» или когда из разговора выделил нового важного.',
  category: 'memory',
  schema: z.object({
    type: z.enum(['person', 'place', 'concept', 'goal', 'organization']),
    name: z.string().min(1).max(120),
    attributes: z.record(z.unknown()).optional(),
    importance: z.number().int().min(1).max(10).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запомни маму', 'запомни Серика как коллегу'],
  handler: async (input, ctx) => {
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: input.type,
      name: input.name,
      attributes: input.attributes ?? {},
      importance: input.importance ?? 5,
    });
    return {
      message: `Запомнил: ${entity.name}`,
      entityId: entity.id,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/tools/remember-entity.test.ts
```
Expected: PASS.

- [ ] **Step 5: tsc**
```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/tools/remember-entity.ts packages/server/src/tools/remember-entity.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-tools): add remember_entity tool (B1)

Agent-callable wrapper around entityGraph.upsertEntity. Reversible
write → needsConfirm:false so autonomous agent-loop can call it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: `link-relationship.ts` tool + test

**Files:**
- Create: `packages/server/src/tools/link-relationship.ts`
- Create: `packages/server/src/tools/link-relationship.test.ts`

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/tools/link-relationship.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkRelationshipTool } from './link-relationship.js';

const SRC = readFileSync(join(__dirname, 'link-relationship.ts'), 'utf8');

describe('linkRelationshipTool — shape', () => {
  it('name + category + side-effects + no confirm', () => {
    expect(linkRelationshipTool.name).toBe('link_relationship');
    expect(linkRelationshipTool.category).toBe('memory');
    expect(linkRelationshipTool.sideEffects).toBe('write');
    expect(linkRelationshipTool.needsConfirm).toBe(false);
  });
  it('schema requires fromName + toName + type', () => {
    expect(() =>
      linkRelationshipTool.schema.parse({
        fromName: 'мама',
        toName: 'Серик',
        type: 'family',
      }),
    ).not.toThrow();
    expect(() =>
      linkRelationshipTool.schema.parse({ fromName: 'a', toName: 'b' }),
    ).toThrow();
  });
  it('schema caps type at 40 + label at 120', () => {
    expect(() =>
      linkRelationshipTool.schema.parse({
        fromName: 'a',
        toName: 'b',
        type: 'x'.repeat(41),
      }),
    ).toThrow();
  });
  it('handler calls getEntityGraph().linkEntities', () => {
    expect(SRC).toMatch(/getEntityGraph\(\)\.linkEntities/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/tools/link-relationship.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement tool**

Create `packages/server/src/tools/link-relationship.ts`:

```typescript
import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * v2.0 Week 5 — agent-callable relationship edge writer. Resolves the
 * two endpoints by name (upsert by canonical name, type defaults to
 * 'person'); writes a typed edge. Reversible (edges are deduped by
 * (from,to,type) in entity-graph) → needsConfirm:false.
 */
export const linkRelationshipTool = defineTool({
  name: 'link_relationship',
  description:
    'Связать два запомненных entities направленным ребром (мама → Серик, ' +
    'type=family). Если endpoint ещё не записан — создастся как person.',
  category: 'memory',
  schema: z.object({
    fromName: z.string().min(1).max(120),
    toName: z.string().min(1).max(120),
    type: z.string().min(1).max(40),
    label: z.string().max(120).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['свяжи маму и Серика как семью'],
  handler: async (input, ctx) => {
    const graph = getEntityGraph();
    const [from, to] = await Promise.all([
      graph.upsertEntity(ctx.userId, {
        type: 'person',
        name: input.fromName,
      }),
      graph.upsertEntity(ctx.userId, { type: 'person', name: input.toName }),
    ]);
    const edge = await graph.linkEntities(ctx.userId, {
      fromId: from.id,
      toId: to.id,
      type: input.type,
      label: input.label,
    });
    return {
      message: `Связал: ${from.name} → ${to.name} (${input.type})`,
      edgeId: edge.id,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/tools/link-relationship.test.ts
```
Expected: PASS.

- [ ] **Step 5: tsc**
```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/tools/link-relationship.ts packages/server/src/tools/link-relationship.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-tools): add link_relationship tool (B2)

Resolves both endpoints by name (auto-upsert as person if missing) and
writes a typed edge via entityGraph.linkEntities. Reversible →
needsConfirm:false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `suggest-goal.ts` tool + test

**Files:**
- Create: `packages/server/src/tools/suggest-goal.ts`
- Create: `packages/server/src/tools/suggest-goal.test.ts`

`needsConfirm: true` is the critical bit — the confirm path is the existing FSM in `jarvis-orchestrator` that picks up `runConfirmedAction(userId, 'suggest_goal', input)` via `runRegistryTool`. Because the security invariant filters confirm tools out of the autonomous agent loop, the bot can *propose* the goal in dialog but the autonomous loop cannot silently create one.

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/tools/suggest-goal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestGoalTool } from './suggest-goal.js';

const SRC = readFileSync(join(__dirname, 'suggest-goal.ts'), 'utf8');

describe('suggestGoalTool — shape', () => {
  it('needsConfirm: true (creates YearlyGoal)', () => {
    expect(suggestGoalTool.name).toBe('suggest_goal');
    expect(suggestGoalTool.needsConfirm).toBe(true);
    expect(suggestGoalTool.sideEffects).toBe('write');
  });
  it('schema enforces area enum + rationale required', () => {
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'health',
        goalText: 'бегать 3х в неделю',
        rationale: 'обсуждали что хочешь форму',
      }),
    ).not.toThrow();
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'love', // invalid
        goalText: 'x',
        rationale: 'y',
      }),
    ).toThrow();
    expect(() =>
      suggestGoalTool.schema.parse({
        area: 'health',
        goalText: 'x',
      }),
    ).toThrow();
  });
  it('handler creates YearlyGoal via prisma', () => {
    expect(SRC).toMatch(/prisma\.yearlyGoal\.create/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/tools/suggest-goal.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement tool**

Create `packages/server/src/tools/suggest-goal.ts`:

```typescript
import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';

/**
 * v2.0 Week 5 — propose a yearly goal. needsConfirm:true → never
 * executed by the autonomous agent loop (security invariant in
 * tools/index.ts agentToolSchemas filter). Confirm-FSM in
 * jarvis-orchestrator routes user «да» back to runRegistryTool here.
 */
export const suggestGoalTool = defineTool({
  name: 'suggest_goal',
  description:
    'Предложить пользователю записать долгосрочную (годовую) цель — ' +
    'юзер ОБЯЗАТЕЛЬНО подтверждает прежде чем цель попадёт в его ' +
    'годовой план. Используй когда из разговора видно сильное желание/' +
    'намерение, ещё не оформленное как цель.',
  category: 'task',
  schema: z.object({
    area: z.enum(['finance', 'career', 'health', 'spirituality']),
    goalText: z.string().min(3).max(300),
    rationale: z
      .string()
      .min(3)
      .max(500)
      .describe('почему бот считает что это стоит цели'),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['предложи цель «бегать 3 раза в неделю»'],
  handler: async (input, ctx) => {
    // Confirm-FSM ensures this fires only after the user said «да».
    const year = new Date().getFullYear();
    const goal = await prisma.yearlyGoal.create({
      data: {
        userId: ctx.userId,
        year,
        area: input.area,
        goal: input.goalText,
        rationale: input.rationale,
      },
    });
    return {
      message: `Цель записана: «${input.goalText}» (${input.area}, ${year})`,
      goalId: goal.id,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/tools/suggest-goal.test.ts
```
Expected: PASS.

- [ ] **Step 5: tsc**
```bash
cd packages/server
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/tools/suggest-goal.ts packages/server/src/tools/suggest-goal.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-tools): add suggest_goal tool (B3, needsConfirm)

Creates YearlyGoal only after user confirmation — security invariant
auto-excludes from autonomous agent loop. Schema requires rationale so
the confirm prompt can show *why* the bot proposes this goal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Wire three tools into registry

**Files:**
- Modify: `packages/server/src/tools/index.ts`
- Create: `packages/server/src/tools/v2-registry.test.ts`

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/tools/v2-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from './index.js';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('v2 tools wired into registry', () => {
  it('registry exposes all 3 v2 tools', () => {
    expect(registry.has('remember_entity')).toBe(true);
    expect(registry.has('link_relationship')).toBe(true);
    expect(registry.has('suggest_goal')).toBe(true);
  });
  it('index.ts imports all 3', () => {
    expect(SRC).toMatch(/from '\.\/remember-entity\.js'/);
    expect(SRC).toMatch(/from '\.\/link-relationship\.js'/);
    expect(SRC).toMatch(/from '\.\/suggest-goal\.js'/);
  });
  it('ALL_TOOLS array lists all 3 by reference', () => {
    expect(SRC).toMatch(/\brememberEntityTool\b/);
    expect(SRC).toMatch(/\blinkRelationshipTool\b/);
    expect(SRC).toMatch(/\bsuggestGoalTool\b/);
  });
  it('suggest_goal correctly excluded from autonomous agent loop', () => {
    // Mirror existing money-safety invariant test pattern.
    const t = registry.get('suggest_goal')!;
    expect(t.needsConfirm).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/tools/v2-registry.test.ts
```
Expected: FAIL — registry has no entries yet.

- [ ] **Step 3: Edit `tools/index.ts` — add 3 imports + 3 array entries**

Add to the import block (after `applyInsightTool` import):

```typescript
import { rememberEntityTool } from './remember-entity.js';
import { linkRelationshipTool } from './link-relationship.js';
import { suggestGoalTool } from './suggest-goal.js';
```

Add to the `ALL_TOOLS` array (just before the closing `]`, after `getUserProfileTool`):

```typescript
  // v2.0 Week 5 — memory tools (B1/B2 reversible) + goal (B3 needsConfirm).
  rememberEntityTool,
  linkRelationshipTool,
  suggestGoalTool,
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/tools/v2-registry.test.ts
npm test -- src/tools/registry-consistency.test.ts
npm test -- src/tools/dispatch-audit.test.ts
```
Expected: PASS (and no regression in existing registry tests).

- [ ] **Step 5: Full suite + tsc + dup-name guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
node -e "require('./dist/tools/index.js')" 2>&1 | grep -i duplicate && exit 1 || echo "no dup ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/tools/index.ts packages/server/src/tools/v2-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-tools): wire remember_entity + link_relationship + suggest_goal into registry (B4)

Three new entries land in ALL_TOOLS; load-time dup-guard + Anthropic
schema autogen pick them up. suggest_goal stays out of the autonomous
agent loop (needsConfirm:true → agentToolSchemas filter).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section C — Telegram `/setname` (1 task)

### Task C1: Add `/setname` command to telegram-bot.ts

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts`
- Create: `packages/server/src/services/telegram-setname.test.ts`

Validation: trim → `length < 1` → usage hint; `length > 30` → too long. Resolves user via existing `findOrCreateUser(chatId, from.id, from.first_name || '', from.username)` exactly as the other handlers do.

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/services/telegram-setname.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'telegram-bot.ts'), 'utf8');

describe('telegram /setname command', () => {
  it('registers bot.command("setname", ...)', () => {
    expect(SRC).toMatch(/bot\.command\(\s*['"]setname['"]/);
  });
  it('parses the argument from ctx.message.text', () => {
    expect(SRC).toMatch(/ctx\.message\.text/);
    expect(SRC).toMatch(/\.split\(['"] ['"]\)|split\(\/ \/\)/);
  });
  it('enforces 1-30 char validation', () => {
    expect(SRC).toMatch(/Использование:\s*\/setname Имя/);
    expect(SRC).toMatch(/слишком длинн|макс\s*30|>\s*30/);
  });
  it('imports + calls getBotIdentityService().updateIdentity with botName', () => {
    expect(SRC).toMatch(/from '\.\/bot-identity\.singleton\.js'/);
    expect(SRC).toMatch(/getBotIdentityService\(\)\.updateIdentity\(/);
    expect(SRC).toMatch(/botName:/);
  });
  it('confirms with «Готово, теперь меня зовут ...»', () => {
    expect(SRC).toMatch(/Готово, теперь меня зовут/);
  });
  it('reuses existing findOrCreateUser (no duplicate user-resolution path)', () => {
    const handler = SRC.slice(
      SRC.indexOf("bot.command('setname'"),
      SRC.indexOf("bot.command('setname'") + 1500,
    );
    expect(handler).toMatch(/findOrCreateUser\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/services/telegram-setname.test.ts
```
Expected: FAIL — command not present.

- [ ] **Step 3: Edit `telegram-bot.ts` — add import + handler**

Add import near top with the other service imports:

```typescript
import { getBotIdentityService } from './bot-identity.singleton.js';
```

Insert the handler immediately after the `bot.start(...)` block (before `bot.on('voice', ...)`):

```typescript
  // v2.0 Week 5 (spec §10.1) — user renames the bot.
  // Validation: 1..30 chars after trim. Persists via IdentityService;
  // the new name flows back into prompts through buildV2EnrichmentBlock
  // (D2) on the very next turn.
  bot.command('setname', async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const from = ctx.from;
    if (!chatId || !from) return;
    const newName = (ctx.message.text ?? '')
      .split(' ')
      .slice(1)
      .join(' ')
      .trim();
    if (newName.length < 1) {
      await ctx.reply('Использование: /setname Имя');
      return;
    }
    if (newName.length > 30) {
      await ctx.reply('Имя слишком длинное (макс 30 символов)');
      return;
    }
    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await getBotIdentityService().updateIdentity(userId, {
        botName: newName,
      });
      await ctx.reply(`Готово, теперь меня зовут ${newName} 🤍`);
    } catch (err) {
      console.error('TG /setname error:', err);
      await ctx.reply('Не получилось переименовать — попробуй ещё раз?');
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/services/telegram-setname.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc**
```bash
cd packages/server
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/telegram-bot.ts packages/server/src/services/telegram-setname.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-telegram): add /setname command (C1)

Validates 1..30 chars, resolves user via existing findOrCreateUser, and
persists through IdentityService.updateIdentity. New name lands in the
next-turn system prompt via buildV2EnrichmentBlock (Week 5 D2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section D — Wiring INBOUND in jarvis-orchestrator (3 tasks)

### Task D1: `v2-capture.ts` — background capture pipeline

**Files:**
- Create: `packages/server/src/services/v2-capture.ts`
- Create: `packages/server/src/services/v2-capture.test.ts`

`captureV2InBackground(userId, text, msgId)` runs sequentially per concern, with **everything in `Promise.allSettled` at the top level** so one fault does not cascade. Order:
1. `extractEntities(text, userId)` → `{ entities, relationships }`.
2. For each entity: `upsertEntity` (sequential — entity-graph dedupes on canonical name; parallel risks dup races).
3. For each relationship: resolve fromId/toId via `upsertEntity` then `linkEntities`.
4. `recordEvent(userId, { type:'message', content:text, sourceId:msgId, entityRefs: <ids> })`.
5. `getEmotionalMemory().analyzeMessage(userId, text, msgId, entityRefs)`.

All logged on failure; never throws.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/v2-capture.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureV2InBackground } from './v2-capture.js';

const SRC = readFileSync(join(__dirname, 'v2-capture.ts'), 'utf8');

describe('v2-capture — structural', () => {
  it('exports captureV2InBackground(userId, text, msgId)', () => {
    expect(typeof captureV2InBackground).toBe('function');
    expect(SRC).toMatch(/export async function captureV2InBackground\(/);
    expect(SRC).toMatch(/userId:\s*string/);
    expect(SRC).toMatch(/text:\s*string/);
    expect(SRC).toMatch(/msgId/);
  });
  it('orchestrates: extractEntities → upsert → link → recordEvent → analyzeMessage', () => {
    expect(SRC).toMatch(/extractEntities\(/);
    expect(SRC).toMatch(/upsertEntity\(/);
    expect(SRC).toMatch(/linkEntities\(/);
    expect(SRC).toMatch(/recordEvent\(/);
    expect(SRC).toMatch(/analyzeMessage\(/);
  });
  it('top-level Promise.allSettled so faults isolate', () => {
    expect(SRC).toMatch(/Promise\.allSettled/);
  });
  it('never throws — outer try/catch returns void on error', () => {
    expect(SRC).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]{0,200}?console\.(warn|error)/);
  });
  it('does NOT call captureMemory or extractFromTranscript (dual-write happens in orchestrator)', () => {
    expect(SRC).not.toMatch(/captureMemory\b/);
    expect(SRC).not.toMatch(/extractFromTranscript\b/);
  });
});

describe('captureV2InBackground — runtime safety', () => {
  it('does not throw on invalid userId', async () => {
    await expect(
      captureV2InBackground('___no_such_user___', 'hi', 'msg-x'),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/services/v2-capture.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement module**

Create `packages/server/src/services/v2-capture.ts`:

```typescript
/**
 * v2.0 Week 5 D1 — INBOUND capture for new memory tiers.
 *
 * Fired from jarvis-orchestrator.captureInBackground when v2 memory is
 * enabled for the user. Runs IN PARALLEL with the legacy
 * extractFromTranscript/captureMemory pipeline (dual-write) so that
 * legacy stays the source of truth for tasks while v2 builds richer
 * episodic/semantic/emotional state.
 *
 * NEVER throws — every sub-step is best-effort, logged on failure.
 * The orchestrator awaits this fire-and-forget; a partial fault must
 * not break legacy capture nor block the user reply.
 */

import { extractEntities } from './entity-extractor.js';
import { getEntityGraph } from './entity-graph/index.js';
import { recordEvent } from './episodic-memory.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';

export async function captureV2InBackground(
  userId: string,
  text: string,
  msgId: string,
): Promise<void> {
  try {
    const graph = getEntityGraph();
    const emotional = getEmotionalMemory();

    // 1. Extract entities + relationships from message text.
    const extracted = await extractEntities(text, userId).catch((err) => {
      console.warn('[v2-capture] extractEntities failed:', err);
      return { entities: [], relationships: [] };
    });

    // 2. Upsert entities sequentially — graph dedupes on canonical name,
    //    parallel races would create duplicates.
    const idByName = new Map<string, string>();
    for (const ent of extracted.entities) {
      try {
        const row = await graph.upsertEntity(userId, {
          type: ent.type,
          name: ent.name,
          attributes: ent.attributes ?? {},
          importance: ent.importance ?? 5,
        });
        idByName.set(ent.name, row.id);
      } catch (err) {
        console.warn(`[v2-capture] upsertEntity ${ent.name} failed:`, err);
      }
    }

    // 3. Relationships — resolve endpoints (upsert if missing), then link.
    //    Done after the entity pass so names found in step 2 are available.
    for (const rel of extracted.relationships ?? []) {
      try {
        const fromId =
          idByName.get(rel.from) ??
          (await graph.upsertEntity(userId, { type: 'person', name: rel.from }))
            .id;
        const toId =
          idByName.get(rel.to) ??
          (await graph.upsertEntity(userId, { type: 'person', name: rel.to }))
            .id;
        idByName.set(rel.from, fromId);
        idByName.set(rel.to, toId);
        await graph.linkEntities(userId, {
          fromId,
          toId,
          type: rel.type,
          label: rel.label,
        });
      } catch (err) {
        console.warn(
          `[v2-capture] linkEntities ${rel.from}→${rel.to} failed:`,
          err,
        );
      }
    }

    // 4 + 5 — episodic event + emotional snapshot in parallel; both
    //   depend only on the entity IDs gathered above, not on each other.
    const entityRefs = Array.from(idByName.values());
    await Promise.allSettled([
      recordEvent(userId, {
        type: 'message',
        content: text,
        sourceId: msgId,
        entityRefs,
      }).catch((err) => {
        console.warn('[v2-capture] recordEvent failed:', err);
      }),
      emotional.analyzeMessage(userId, text, msgId, entityRefs).catch((err) => {
        console.warn('[v2-capture] analyzeMessage failed:', err);
      }),
    ]);
  } catch (err) {
    // Top-level guard — must never throw to caller.
    console.warn('[v2-capture] unexpected error:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/services/v2-capture.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/v2-capture.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-capture.ts packages/server/src/services/v2-capture.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-wiring): v2-capture pipeline — entities + episodic + emotional (D1)

Fire-and-forget background capture for v2 memory tiers. Sequential
entity upsert (avoid dup races), then relationship linking, then
parallel recordEvent + analyzeMessage. Per-step + top-level guards
ensure the function never throws — legacy captureInBackground stays
unaffected on any v2 fault.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D2: `v2-enrichment.ts` — system-prompt enrichment block

**Files:**
- Create: `packages/server/src/services/v2-enrichment.ts`
- Create: `packages/server/src/services/v2-enrichment.test.ts`

Two exports:
- `fetchV2EnrichmentData(userId): Promise<V2EnrichmentData | null>` — async I/O.
- `buildV2EnrichmentBlock(data: V2EnrichmentData): string` — **pure**, fully unit-testable. Block format (Russian, plain text, no markdown — matches existing `buildJarvisPrompt` style):

```
[v2-память]
имя: {botName} (стиль: {style})
активные паттерны: {pattern1}; {pattern2}; {pattern3}
настроение: сдвиг {magnitude} (baseline {b} → recent {r})
ключевые люди/места: {name} (важн {imp}, виделись {daysAgo}д назад); ...
```

Fields omitted entirely when their data is missing — block is whitespace-stable so prompt diff stays small turn-to-turn.

- [ ] **Step 1: Write failing tests**

Create `packages/server/src/services/v2-enrichment.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildV2EnrichmentBlock,
  type V2EnrichmentData,
} from './v2-enrichment.js';

const SRC = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');

const FULL: V2EnrichmentData = {
  identity: { botName: 'Жозефина', style: 'warm' },
  patterns: [
    { kind: 'frequency', summary: 'звонки маме ~раз в 4 дня' },
    { kind: 'time_of_day', summary: 'кофе 08:30 ±20м' },
    { kind: 'commitment', summary: 'обещал отчёт к пятнице' },
  ],
  moodShift: { magnitude: -0.5, baseline: 0.1, recent: -0.4 },
  entities: [
    { name: 'мама', importance: 9, daysSinceLastSeen: 3 },
    { name: 'Серик', importance: 7, daysSinceLastSeen: 1 },
  ],
};

describe('buildV2EnrichmentBlock — pure', () => {
  it('starts with the v2-память header', () => {
    expect(buildV2EnrichmentBlock(FULL)).toMatch(/^\[v2-память\]/);
  });
  it('renders bot name + style on identity line', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/имя:\s*Жозефина.*стиль:\s*warm/);
  });
  it('joins patterns with «; »', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/звонки маме[^;]*;.*кофе[^;]*;.*обещал отчёт/s);
  });
  it('renders mood shift magnitude with one decimal', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/сдвиг -0\.5/);
  });
  it('renders entity line with importance + days ago', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/мама \(важн 9, виделись 3д назад\)/);
  });
  it('omits patterns line when none', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, patterns: [] });
    expect(out).not.toMatch(/активные паттерны/);
  });
  it('omits mood line when no shift', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, moodShift: null });
    expect(out).not.toMatch(/настроение/);
  });
  it('omits entities line when none', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, entities: [] });
    expect(out).not.toMatch(/ключевые/);
  });
  it('falls back to JARVIS when no identity', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, identity: null });
    expect(out).toMatch(/имя:\s*JARVIS/);
  });
  it('caps patterns at 3 and entities at 5', () => {
    const many: V2EnrichmentData = {
      ...FULL,
      patterns: Array.from({ length: 10 }, (_, i) => ({
        kind: 'frequency',
        summary: `p${i}`,
      })),
      entities: Array.from({ length: 10 }, (_, i) => ({
        name: `e${i}`,
        importance: i,
        daysSinceLastSeen: i,
      })),
    };
    const out = buildV2EnrichmentBlock(many);
    expect((out.match(/p\d/g) ?? []).length).toBe(3);
    expect((out.match(/\be\d\b/g) ?? []).length).toBe(5);
  });
});

describe('structural — fetcher', () => {
  it('exports fetchV2EnrichmentData', () => {
    expect(SRC).toMatch(/export async function fetchV2EnrichmentData\(/);
  });
  it('queries identity + procedural patterns + emotional shift + entities', () => {
    expect(SRC).toMatch(/getBotIdentityService\(\)/);
    expect(SRC).toMatch(/getActivePatterns\(/);
    expect(SRC).toMatch(/minConfidence:\s*0\.6/);
    expect(SRC).toMatch(/detectMoodShift\(/);
    expect(SRC).toMatch(/topEntities\(|staleEntities\(|orderBy:.*importance/);
  });
  it('returns null on top-level failure (best-effort)', () => {
    expect(SRC).toMatch(/return null/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/services/v2-enrichment.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement module**

Create `packages/server/src/services/v2-enrichment.ts`:

```typescript
/**
 * v2.0 Week 5 D2 — system-prompt enrichment from new memory tiers.
 *
 * Pure builder (buildV2EnrichmentBlock) + async fetcher
 * (fetchV2EnrichmentData). Orchestrator appends the rendered block to
 * the system prompt only when isV2MemoryEnabled — additive, never
 * touches the legacy buildJarvisPrompt output.
 *
 * Block is whitespace-stable: missing data drops the *whole* line so
 * prompt diff stays predictable turn-to-turn.
 */

import { prisma } from '../lib/prisma.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
import { getProceduralMemory } from './procedural-memory.singleton.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';

export type V2EnrichmentData = {
  identity: { botName: string; style: string } | null;
  patterns: Array<{ kind: string; summary: string }>;
  moodShift: { magnitude: number; baseline: number; recent: number } | null;
  entities: Array<{
    name: string;
    importance: number;
    daysSinceLastSeen: number;
  }>;
};

export function buildV2EnrichmentBlock(data: V2EnrichmentData): string {
  const lines: string[] = ['[v2-память]'];
  const id = data.identity;
  lines.push(`имя: ${id?.botName ?? 'JARVIS'} (стиль: ${id?.style ?? 'default'})`);
  if (data.patterns.length > 0) {
    const top = data.patterns.slice(0, 3).map((p) => p.summary).join('; ');
    lines.push(`активные паттерны: ${top}`);
  }
  if (data.moodShift) {
    const m = data.moodShift;
    lines.push(
      `настроение: сдвиг ${m.magnitude.toFixed(1)} ` +
        `(baseline ${m.baseline.toFixed(1)} → recent ${m.recent.toFixed(1)})`,
    );
  }
  if (data.entities.length > 0) {
    const top = data.entities
      .slice(0, 5)
      .map(
        (e) =>
          `${e.name} (важн ${e.importance}, виделись ${e.daysSinceLastSeen}д назад)`,
      )
      .join('; ');
    lines.push(`ключевые люди/места: ${top}`);
  }
  return lines.join('\n');
}

const DAY_MS = 86_400_000;

export async function fetchV2EnrichmentData(
  userId: string,
): Promise<V2EnrichmentData | null> {
  try {
    const [identity, patterns, moodShift, entityRows] = await Promise.all([
      getBotIdentityService()
        .getIdentity(userId)
        .catch(() => null),
      getProceduralMemory()
        .getActivePatterns(userId, { minConfidence: 0.6 })
        .catch(() => []),
      getEmotionalMemory()
        .detectMoodShift(userId)
        .catch(() => null),
      prisma.entity
        .findMany({
          where: { userId },
          orderBy: [{ importance: 'desc' }, { lastSeenAt: 'desc' }],
          take: 5,
          select: { name: true, importance: true, lastSeenAt: true },
        })
        .catch(() => []),
    ]);
    const now = Date.now();
    return {
      identity: identity
        ? { botName: identity.botName, style: identity.style }
        : null,
      patterns: (patterns ?? []).slice(0, 3).map((p) => ({
        kind: p.kind,
        summary: String(
          (p.meta as Record<string, unknown> | null)?.summary ??
            `${p.kind} (conf ${p.confidence.toFixed(2)})`,
        ),
      })),
      moodShift: moodShift
        ? {
            magnitude: Number(moodShift.magnitude),
            baseline: Number(moodShift.baseline),
            recent: Number(moodShift.recent),
          }
        : null,
      entities: entityRows.map((e) => ({
        name: e.name,
        importance: e.importance,
        daysSinceLastSeen: Math.max(
          0,
          Math.floor((now - (e.lastSeenAt?.getTime() ?? now)) / DAY_MS),
        ),
      })),
    };
  } catch (err) {
    console.warn('[v2-enrichment] fetch failed:', err);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/services/v2-enrichment.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/v2-enrichment.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/v2-enrichment.ts packages/server/src/services/v2-enrichment.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-wiring): v2-enrichment system-prompt block builder + fetcher (D2)

Pure buildV2EnrichmentBlock (10 unit tests covering every omission
path) + async fetchV2EnrichmentData. Caps: top 3 patterns
(minConfidence 0.6), top 5 entities by importance. Whitespace-stable
when data is missing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task D3: Wire D1 + D2 into `jarvis-orchestrator.ts`

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Create: `packages/server/src/services/jarvis-orchestrator-v2.test.ts`

Two edits, both behind `isV2MemoryEnabled(userId)`:

A. In `captureInBackground(userId, text)` — at the very end of the `try` block (after the memories loop, before `return { tasks, memories }`), launch `captureV2InBackground` fire-and-forget. **Do not** `await` it: this function is itself already invoked fire-and-forget by `handleMessage`, but the inner await would couple v2 latency to the legacy capture's return — which we must avoid (legacy is the source of truth for tasks). `void` + `.catch` is the established pattern.

B. In `handleMessage`, around the system-prompt construction (lines 808-816), after `system` is assigned, conditionally append the v2 enrichment block. Important: only when `gathered` exists (otherwise the fallback string is the right escape hatch and the user is anyway not fully present in the DB).

The third edit is preserving the existing `assistantMessageId` argument plumbing — current `captureInBackground` only takes `(userId, text)`. We add an optional third param `msgId?: string` so v2 capture can record `sourceId`. Legacy ignores it (already does).

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/services/jarvis-orchestrator-v2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'jarvis-orchestrator.ts'), 'utf8');

describe('jarvis-orchestrator — v2 wiring (D3)', () => {
  it('imports captureV2InBackground from v2-capture', () => {
    expect(SRC).toMatch(/from '\.\/v2-capture\.js'/);
    expect(SRC).toMatch(/captureV2InBackground/);
  });
  it('imports buildV2EnrichmentBlock + fetchV2EnrichmentData', () => {
    expect(SRC).toMatch(/from '\.\/v2-enrichment\.js'/);
    expect(SRC).toMatch(/buildV2EnrichmentBlock/);
    expect(SRC).toMatch(/fetchV2EnrichmentData/);
  });
  it('imports isV2MemoryEnabled', () => {
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
    expect(SRC).toMatch(/isV2MemoryEnabled/);
  });
  it('captureInBackground wraps captureV2 in isV2MemoryEnabled gate, fire-and-forget', () => {
    const capFn = SRC.slice(SRC.indexOf('async function captureInBackground'));
    const head = capFn.slice(0, 3000);
    expect(head).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(head).toMatch(/void\s+captureV2InBackground\(/);
    expect(head).toMatch(/\.catch\(/);
  });
  it('preserves legacy dual-write — extractFromTranscript + captureMemory still present', () => {
    expect(SRC).toMatch(/extractFromTranscript\(/);
    expect(SRC).toMatch(/captureMemory\(/);
  });
  it('handleMessage appends v2 enrichment block to system prompt under flag', () => {
    const handle = SRC.slice(SRC.indexOf('export async function handleMessage'));
    expect(handle).toMatch(/isV2MemoryEnabled\(\s*userId\s*\)/);
    expect(handle).toMatch(/fetchV2EnrichmentData\(\s*userId\s*\)/);
    expect(handle).toMatch(/buildV2EnrichmentBlock\(/);
    // Block is appended (string concat) — not replacing system.
    expect(handle).toMatch(/system\s*\+=|system\s*=\s*system\s*\+/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/services/jarvis-orchestrator-v2.test.ts
```
Expected: FAIL — wiring not present.

- [ ] **Step 3: Edit `jarvis-orchestrator.ts`**

Add to the import block (near the other service imports):

```typescript
import { isV2MemoryEnabled } from '../lib/feature-flags.js';
import { captureV2InBackground } from './v2-capture.js';
import {
  buildV2EnrichmentBlock,
  fetchV2EnrichmentData,
} from './v2-enrichment.js';
```

**Edit 1** — extend `captureInBackground` signature + add v2 hook. Change line 119:

```typescript
async function captureInBackground(
  userId: string,
  text: string,
  msgId?: string,
): Promise<{ tasks: number; memories: number }> {
```

Inside the same function, immediately before `return { tasks, memories };` (around line 165), add:

```typescript
    // v2.0 Week 5 D3 — dual-write to new memory tiers behind flag.
    // Fire-and-forget so legacy capture's return time is unchanged;
    // captureV2InBackground itself has top-level try/catch and never throws.
    if (isV2MemoryEnabled(userId)) {
      void captureV2InBackground(userId, text, msgId ?? 'unknown').catch(
        (err) => console.warn('[v2-capture] hook:', err),
      );
    }
```

**Edit 2** — append v2 enrichment to system prompt in `handleMessage`. Replace the block at lines 808-816 (the `const system = ...` assignment) with:

```typescript
  const optIn = gathered?.context.therapeuticMode !== false;
  const finalTherapeutic = therapeuticMode && optIn;

  let system = gathered
    ? buildJarvisPrompt(gathered.context, {
        ...ritualOptsFor(intent, gathered.dayCompletionPercent),
        channel,
        therapeuticMode: finalTherapeutic,
      })
    : 'Ты — JARVIS, дружелюбный AI-ассистент. Отвечай по-русски, кратко, без markdown.';

  // v2.0 Week 5 D3 — additive memory enrichment block (best-effort,
  // dropped silently on fault → legacy prompt unaffected).
  if (gathered && isV2MemoryEnabled(userId)) {
    try {
      const v2Data = await fetchV2EnrichmentData(userId);
      if (v2Data) {
        system = system + '\n\n' + buildV2EnrichmentBlock(v2Data);
      }
    } catch (err) {
      console.warn('[v2-enrichment] hook failed:', err);
    }
  }
```

Also pass `msgId` through where `captureInBackground` is invoked. Find the call site (search for `captureInBackground(`) and add the assistant-message ID as third arg (use whatever message-id variable already exists in scope — most likely the variable holding the persisted user-msg row id, fall back to a `Date.now()` synthetic if none is available). Example shape:

```typescript
  void captureInBackground(userId, text, /* msgId */ String(Date.now())).catch(
    (err) => console.warn('[captureInBackground]', err),
  );
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/services/jarvis-orchestrator-v2.test.ts
npm test -- src/services/orchestrator-gating.test.ts
```
Expected: PASS (and orchestrator-gating still green — legacy path unchanged).

- [ ] **Step 5: Full suite + tsc + vi.mock guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/jarvis-orchestrator-v2.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/jarvis-orchestrator.ts packages/server/src/services/jarvis-orchestrator-v2.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-wiring): dual-write v2 capture + enrichment block in orchestrator (D3)

captureInBackground fire-and-forwards to captureV2InBackground behind
isV2MemoryEnabled — legacy extractFromTranscript/captureMemory paths
preserved verbatim (dual-write). handleMessage appends
buildV2EnrichmentBlock to system prompt only when gathered context and
flag both present. Both hooks best-effort: any v2 fault logged, never
breaks the user-facing reply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section E — Wiring OUTBOUND in proactive-scheduler (1 task)

### Task E1: Hook `runForUser` into scheduler tick

**Files:**
- Modify: `packages/server/src/services/proactive-scheduler.ts`
- Create: `packages/server/src/services/proactive-scheduler-v2.test.ts`

The existing `tick()` has a per-user `for` loop (line 90). We insert the v2 hook **before** `deliverTopInsight` (line ~190) so a v2 nudge written this tick can be picked up by the same `deliverTopInsight` call (it queries `undelivered` insights with no source filter — both reflector and v2-proactivity flow through the unified store).

- [ ] **Step 1: Write failing structural test**

Create `packages/server/src/services/proactive-scheduler-v2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'proactive-scheduler.ts'), 'utf8');

describe('proactive-scheduler — v2 wiring (E1)', () => {
  it('imports isV2ProactivityEnabled', () => {
    expect(SRC).toMatch(/from '\.\.\/lib\/feature-flags\.js'/);
    expect(SRC).toMatch(/isV2ProactivityEnabled/);
  });
  it('imports getProactivityEngine', () => {
    expect(SRC).toMatch(/from '\.\/v2-proactivity-engine\.singleton\.js'/);
    expect(SRC).toMatch(/getProactivityEngine/);
  });
  it('hook is flag-gated, awaited inside try/catch with console.warn', () => {
    expect(SRC).toMatch(/isV2ProactivityEnabled\(\s*userId\s*\)/);
    expect(SRC).toMatch(/getProactivityEngine\(\)\.runForUser\(\s*userId\s*\)/);
    expect(SRC).toMatch(/\[v2-proactivity\]/);
  });
  it('runs BEFORE deliverTopInsight so same tick can push the new nudge', () => {
    const tickFn = SRC.slice(SRC.indexOf('async function tick'));
    expect(tickFn.indexOf('runForUser')).toBeGreaterThan(0);
    expect(tickFn.indexOf('runForUser')).toBeLessThan(
      tickFn.indexOf('deliverTopInsight'),
    );
  });
  it('failure does not break tick (caught locally, continue loop)', () => {
    expect(SRC).toMatch(/catch[\s\S]{0,120}?\[v2-proactivity\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd packages/server
npm test -- src/services/proactive-scheduler-v2.test.ts
```
Expected: FAIL — hook not present.

- [ ] **Step 3: Edit `proactive-scheduler.ts`**

Add imports near the top:

```typescript
import { isV2ProactivityEnabled } from '../lib/feature-flags.js';
import { getProactivityEngine } from './v2-proactivity-engine.singleton.js';
```

Inside the `for (const { id: userId } of users)` loop, **immediately before** the `// R6 — ЕДИНЫЙ Insight-стор` block (the `deliverTopInsight` try around line 188), insert:

```typescript
      // v2.0 Week 5 E1 — proactivity engine tick (behind flag, per-user).
      // Runs BEFORE deliverTopInsight so a nudge persisted this tick can
      // be pushed in the same loop iteration (unified insight store).
      // НЕ-фатально: per-user catch, остальные юзеры обрабатываются.
      if (isV2ProactivityEnabled(userId)) {
        try {
          await getProactivityEngine().runForUser(userId);
        } catch (err) {
          console.warn(
            `[v2-proactivity] runForUser failed user=${userId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd packages/server
npm test -- src/services/proactive-scheduler-v2.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full suite + tsc + vi.mock guard**
```bash
cd packages/server
npm test
npx tsc --noEmit
grep -n "vi\.mock" src/services/proactive-scheduler-v2.test.ts && exit 1 || echo "no mocks ok"
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/services/proactive-scheduler.ts packages/server/src/services/proactive-scheduler-v2.test.ts
git commit -m "$(cat <<'EOF'
feat(v2-wiring): hook v2 proactivity engine into scheduler tick (E1)

Per-user, behind isV2ProactivityEnabled, runs BEFORE deliverTopInsight
so a nudge persisted this tick is pushed on the same tick via the
unified insight store. Per-user try/catch — a single user's engine
failure cannot break the tick loop for everyone else.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section F — Berik-only rollout (1 task)

### Task F1: Berik SMOKE checklist + ENV instructions + rollback doc

**Files:**
- Create: `docs/SMOKE-v2-week5.md`

This task is a **docs-only commit** — it does NOT modify production behavior on its own. Berik manually runs the ENV-set commands inside Railway to flip the feature flags AFTER G1 lands and the deploy is green. Until then, both flags default OFF for everyone (no behavioral change in prod from the Week 5 code merge alone).

- [ ] **Step 1:** Create `docs/SMOKE-v2-week5.md` with the following content:

````markdown
# v2.0 Week 5 — SMOKE checklist (Berik only)

**Goal:** validate v2 memory + proactivity end-to-end on prod with a single user (Berik) before opening to Aydana (Week 7).

**Prerequisites:**
1. Server deployed to Railway with Week 5 code merged to `main`.
2. Berik's userId known (from prod DB: `SELECT id FROM "User" WHERE email = '<berik_email>';`).
3. Two new ENV vars set on Railway (DO NOT enable for anyone else):
   - `FEATURE_V2_MEMORY=user-{berikUserId}`
   - `FEATURE_V2_PROACTIVITY=user-{berikUserId}`
4. Railway will auto-redeploy on env change. Wait for green health check.

**ENV-set commands (Berik runs manually):**
```bash
# In Railway dashboard or via CLI:
railway variables set FEATURE_V2_MEMORY=user-<paste-berik-id>
railway variables set FEATURE_V2_PROACTIVITY=user-<paste-berik-id>
# Trigger redeploy if needed.
```

**Rollback (if regression spotted):**
```bash
railway variables set FEATURE_V2_MEMORY=none
railway variables set FEATURE_V2_PROACTIVITY=none
# Both flags off → orchestrator/scheduler skip v2 paths bit-identically to pre-Week-5.
# Existing prod data in Memory/captureMemory untouched.
```

## Day 1 — Basic capture + identity

- [ ] `/setname Соя` — expect reply `Готово, теперь меня зовут Соя 🤍`.
- [ ] `/setname ` (empty) — expect `Использование: /setname Имя`.
- [ ] `/setname Очень-Длинное-Имя-Которое-Точно-Длиннее-Тридцати` — expect rejection.
- [ ] DB check: `SELECT * FROM "BotIdentity" WHERE "userId" = '<berik>';` — `botName = 'Соя'`.
- [ ] Send a normal chat msg: `"Помни, мою маму зовут Гульнара, живёт в Алматы"`.
- [ ] DB check 30s later:
  - `SELECT * FROM "Entity" WHERE "userId" = '<berik>' AND name ILIKE '%гульнара%';` — one row, type=person.
  - `SELECT * FROM "Entity" WHERE name ILIKE '%алматы%';` — one row, type=place.
  - `SELECT * FROM "Memory" WHERE "userId" = '<berik>' ORDER BY "createdAt" DESC LIMIT 1;` — STILL written (dual-write preserved).
- [ ] Bot reply itself should be unaffected (no regression in tone or completion).

## Day 2 — Entity awareness + prompt enrichment

- [ ] Send: `"что ты помнишь про мою маму?"` — bot should mention "Гульнара" and "Алматы" without the user repeating those names this turn (proves V2 enrichment block landed in prompt).
- [ ] Tail Railway logs while sending the message — look for: no `v2-` warnings.
- [ ] Send: `"опять с мамой поссорился"` — emotional. Check MoodSnapshot row created within 30s.

## Day 3 — Proactivity

- [ ] Manually invoke a single scheduler tick (or wait for next 10-min tick).
- [ ] If no candidates: log `candidates=0 passed=0 delivered=0` is normal — proactivity needs accumulated data (patterns, stale entities). Berik likely doesn't have streak_break/frequency patterns yet — DETECTION COVERAGE in Week 5 is sparse-by-design. Goal is no crashes.
- [ ] DB sanity: `SELECT source, COUNT(*) FROM "Insight" WHERE "userId" = '<berik>' GROUP BY source;` — `v2-proactivity` may be 0 (acceptable Week 5; spike expected Week 6 after cron extraction).
- [ ] Confirm no extra TG spam: bot's existing `/start`, `/setname`, voice, text behaviours unchanged outside the test interactions.

## Acceptance criteria

- [ ] No 5xx errors in Railway logs caused by `v2-`/`captureV2`/`proactivity` code paths.
- [ ] Old captureMemory continues to write (`SELECT count(*) FROM "Memory" WHERE "userId" = '<berik>' AND "createdAt" > now() - interval '3 days'` shows growth).
- [ ] At least 2 Entity rows created for Berik in 3 days.
- [ ] At least 1 MoodSnapshot for Berik in 3 days.
- [ ] `/setname` round-trip works.
- [ ] Bot reply quality not visibly worse than Week 4.

## Failure response

If any **acceptance** fails or any unexplained 5xx spike appears:
1. Flip both flags to `none` in Railway (see Rollback above).
2. Open issue, attach Railway log excerpt + reproduction.
3. Do NOT proceed to Week 6 Aydana extension until root-cause fix lands.
````

- [ ] **Step 2:** Verify the doc file structure:

```bash
ls docs/SMOKE-v2-week5.md
wc -l docs/SMOKE-v2-week5.md
```

Expected: file exists, ≥ 60 lines.

- [ ] **Step 3:** Verify zero source-code modifications in F1:

```bash
git diff --stat packages/server/src/
```

Expected: empty (this task is docs-only).

- [ ] **Step 4: Commit**

```bash
git add docs/SMOKE-v2-week5.md
git commit -m "$(cat <<'EOF'
docs(v2-rollout): Week 5 Berik SMOKE checklist + ENV instructions + rollback (F1)

3-day SMOKE plan for Berik-only validation of v2 memory + proactivity
on prod before extending to Aydana in Week 7. Includes ENV-set
commands (FEATURE_V2_MEMORY + FEATURE_V2_PROACTIVITY scoped to
user-{berikId}), per-day check items (identity, entity capture,
prompt enrichment, proactivity tick), acceptance criteria, and
instant rollback procedure (single ENV flip → bit-identical pre-Week-5
behavior). Berik runs the ENV-set + SMOKE manually after deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section G — Final verify (1 task)

### Task G1: Full verification + Week 5 progress commit

- [ ] **Step 1:** Full server test suite:

```bash
cd packages/server && npm test
```

Expect green: every previously-passing test PLUS new files:
- `v2-proactivity-engine.test.ts` + `.singleton.test.ts`
- `v2-capture.test.ts`
- `v2-enrichment.test.ts`
- `remember-entity.test.ts` + `link-relationship.test.ts` + `suggest-goal.test.ts`
- `telegram-setname.test.ts`
- `jarvis-orchestrator-v2.test.ts`
- `proactive-scheduler-v2.test.ts`

- [ ] **Step 2:** `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3:** vi.mock total across `src/` = 0:

```bash
grep -r "vi\.mock" packages/server/src/ | wc -l
```

- [ ] **Step 4:** No `'not yet implemented'` stubs remain in Week 5 files:

```bash
grep -rn "not yet implemented" packages/server/src/services/v2-proactivity-engine.ts \
                                packages/server/src/services/v2-capture.ts \
                                packages/server/src/services/v2-enrichment.ts \
                                packages/server/src/tools/remember-entity.ts \
                                packages/server/src/tools/link-relationship.ts \
                                packages/server/src/tools/suggest-goal.ts
```

Expected: empty.

- [ ] **Step 5:** Zero schema diffs:

```bash
git diff main -- packages/server/prisma/schema.prisma
```

Expected: empty.

- [ ] **Step 6:** Verify old chat pipeline preserved — quick sanity:

```bash
grep -c "extractFromTranscript\|captureMemory" packages/server/src/services/jarvis-orchestrator.ts
```

Both substrings still present (dual-write intact).

- [ ] **Step 7:** Update `docs/plan/v2-memory-proactivity-scope.md` Week 5 tracker line + add Week 5 done block to `~/.claude/projects/-Users-berikkurmangoliev-Desktop-LifeOS/memory/v2_memory_proactivity_scope.md` (rules per protocol — cross-session memory is updated outside source tree but tracked in spec). For the in-repo doc edit only:

Find the Week 5 row in the progress tracker and flip its status.

- [ ] **Step 8: Commit (allow-empty if only docs):**

```bash
git add docs/plan/v2-memory-proactivity-scope.md
git commit --allow-empty -m "$(cat <<'EOF'
docs(v2-progress): Week 5 DONE — Proactivity engine + 3 agent tools + Telegram /setname + jarvis-orchestrator + scheduler wiring + Berik-only rollout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec Coverage Table

| Spec section / API | Task |
|---|---|
| §9.1 scheduler hookup (`tickForUser` → engine call) | E1 |
| §9.2 `ProactivityEngine` interface + `NudgeCandidate` type | A1 |
| §9.3 `gate1_DND` | A4 |
| §9.3 `gate2_RateLimit` (≤2/day Insight count with `source: 'v2-proactivity'`) | A4 |
| §9.3 `gate3_Significance` (>= 0.6) | A1 |
| §9.3 `gate4_Dedup` (Insight metadata path `entityId`, 7d window) | A4 |
| §9.4 `scoreSignificance` (5 sources) | A1 |
| §9.5 template lookup + Claude haiku fallback | A5 |
| §9.5 nudge text persistence into Insight (uses existing `deliverTopInsight` path) | A6 |
| §9.6 Cron tasks | **NOT in scope** — Berik-locked to Week 6 |
| §10.1 Telegram `/setname` command | C1 |
| §10.2 `remember_entity` tool | B1 |
| §10.2 `link_relationship` tool | B2 |
| §10.2 `suggest_goal` tool (needsConfirm:true) | B3 |
| §10.2 `suggest_task`/`suggest_event`/`suggest_habit` | **NOT in scope** — Berik-locked to Week 6/Phase B |
| §8.1 inbound consolidation (msg → extract → upsert → recordEvent → analyzeMessage) | D1 |
| §8.2 outbound proactivity (tick → detect → filter → generate → deliver) | A6 + E1 |
| §11 migration plan | **NOT in scope** — Week 6 |
| §12.3 behavioral SMOKE | F1 (Berik-runs-manually doc) |
| §13.1 Berik first-stage flag rollout | F1 |
| §13.2 flag implementation | Pre-existing from Week 2 (`isV2MemoryEnabled` + `isV2ProactivityEnabled`) |
| Detection: stale_entity | A2 |
| Detection: commitment_due | A2 |
| Detection: mood_shift | A3 |
| Detection: streak_break | A3 |
| Detection: goal_no_progress | A3 |
| Singleton accessor | A6 |
| Orchestrator dual-write | D3 |
| Orchestrator prompt enrichment | D2 + D3 |

All scoped spec items map to a task.

### 2. Placeholder Scan

Intentional `throw new Error('X not yet implemented — Task AN')` stubs introduced in A1 on `runForUser`/`detectCandidates`/`filterCandidates`/`generateNudge`. Replaced fully by A3 (detectCandidates), A4 (filterCandidates), A5 (generateNudge), A6 (runForUser). **By G1 Step 4**, the count of `not yet implemented` in Week 5 files must be zero.

### 3. Type Consistency

| Symbol | Defined in | Used in |
|---|---|---|
| `ProactivityEngine` interface | engine.ts (A1) | class impl (A1), singleton (A6), scheduler (E1) |
| `NudgeCandidate` type | engine.ts (A1) | all detectors (A2–A3), gates (A4), templates (A5), runForUser (A6) |
| `NudgeSource` union | engine.ts (A1) | `TEMPLATES` (A5), `scoreSignificance` (A1) |
| `V2EnrichmentData` interface | v2-enrichment.ts (D2) | orchestrator fetcher (D3) |
| Pure helpers — `scoreSignificance`, `gate3_Significance`, `interpolate`, `TEMPLATES`, `buildV2Enrichment` | engine.ts / enrichment.ts | tested without DB |
| Singleton accessors `getProactivityEngine` + `_resetProactivityEngineForTests` | singleton.ts (A6) | scheduler (E1), tests |
| Tools `Tool<>` via `defineTool` | B1/B2/B3 | registry (B4) |
| `isV2MemoryEnabled` / `isV2ProactivityEnabled` | pre-existing | orchestrator (D3), scheduler (E1) |
| Existing `getEntityGraph`, `getProceduralMemory`, `getEmotionalMemory`, `getBotIdentityService`, `extractEntities`, `recordEvent` | Week 2–4 | engine.ts (A2/A3/A5), v2-capture.ts (D1), orchestrator enrichment (D3) |

No mismatches.

### 4. Test Pattern Compliance

- **Zero `vi.mock`** — confirmed in G1 Step 3 grep across `packages/server/src/`. Each task ends with explicit `grep -c "vi\.mock"` step.
- **Pure helpers exported separately from async methods** — `scoreSignificance`, `gate3_Significance`, `interpolate`, `TEMPLATES`, `buildV2Enrichment` are all pure and unit-testable; same shape as Week 4 (`clampValence`, `medianInterval`, etc.).
- **Structural tests** use `readFileSync` + grep — same pattern as Week 3/4 (`procedural-memory.test.ts`, `bot-identity.test.ts`, `entity-graph/postgres-impl.test.ts`).
- **Tool tests** mirror existing `money-safety.test.ts` shape — direct `import { tool }` + `tool.schema.safeParse(...)` checks. No DB, no Claude.
- **Integration tests for wiring** (`jarvis-orchestrator-v2.test.ts`, `proactive-scheduler-v2.test.ts`, `telegram-setname.test.ts`) use `readFileSync` of the modified source + grep for the integration pattern (function names called, flag gating present, dual-write preserved). This is the same pattern as Week 4's `*.singleton.test.ts` files — no execution, no mocks, but they fail loudly the moment someone removes the wiring.
- **Singleton reset helpers** (`_resetProactivityEngineForTests`) mirror `_resetWorkingMemoryForTests`/`_resetEntityGraphForTests`.

### 5. Edge Case Enumeration (drawing from spec §14)

| # | Failure mode (spec §14) | Handled by |
|---|---|---|
| 1 | Entity extraction race (parallel msgs → same entity) | D1 — `captureV2InBackground` upserts entities **sequentially**, relying on existing `Entity_userId_type_name_key` unique constraint from Week 2. Caught in per-step try/catch. |
| 2 | validAt > invalidAt | Pre-existing `validateEventInput` in episodic-memory.ts (Week 2) throws; D1 catches per-step. |
| 3 | Recursive CTE runaway | Out of Week 5 scope — `getNeighbors` not called. |
| 4 | Voyage embedding API down on upsert | Pre-handled in Week 3 `upsertEntity` (best-effort embedding). D1 just calls upsert. |
| 5 | Claude extractor timeout | D1 wraps `extractEntities` in try/catch; on failure → no entities, the rest of the flow still runs. |
| 6 | Pattern extractor crashes | Not invoked in Week 5 hot path; engine reads existing patterns via `getActivePatterns`. Wrapped in try/catch in A2/A3. |
| 7 | Proactivity tick crashes | E1 wraps `runForUser` in try/catch with `console.warn`. Scheduler tick never fails. |
| 8 | 4-gate falsely blocks all nudges | Documented in F1 SMOKE — Berik checks `SELECT count FROM "Insight" WHERE source='v2-proactivity'`. If 0 after 7 days of activity, alert. |
| 9 | False-positive nudge (entity mentioned yesterday but flagged stale) | A2 — `staleEntities(userId, 7, 5)` filters lastSeenAt cutoff; pattern-based gapRatio further requires frequency confidence ≥ 0.6. |
| 10 | Migration partial fail | Migration is Week 6. Out of scope. |
| 11 | Feature flag flip breaks prod | F1 documents instant rollback (`FEATURE_V2_*=none`). Both flags default OFF (`pre-existing default`). Dual-write preserves Memory rows. |
| 12 | MoodSnapshot grows unbounded | Cron is Week 6. Berik 3-day SMOKE window can't accumulate enough rows to matter. |
| 13 | Bot spams despite rate-limit | A4 `gate2_RateLimit` enforces ≤2/day; A6 re-checks gate2 inside the per-candidate loop (defence in depth). |
| 14 | Pattern stale, not invalidated | `invalidateStale` exists from Week 4; cron call → Week 6. Engine `getActivePatterns` already filters `invalidAt: null`. |
| 15 | Two Seriks (brother + colleague) collision | Pre-handled in Week 3 `resolveEntity`. D1 just calls upsert/resolve. Linkage handled by `name` uniqueness key. |
| 16 | Concurrent upsert race | Sequential upsert in D1 (per-message ordering); existing unique constraint handles cross-message races. |
| 17 | Dual-write conflict (old captureMemory + new v2 path) | **By design** — old path writes Memory; new path writes Entity/MoodSnapshot/Pattern (different tables). No conflict. D3 test verifies both `extractFromTranscript` and `captureMemory` calls preserved. |
| 18 | MoodSnapshot retention | Week 6 cron. Out of scope. |
| 19 | Entity resolution Voyage cost | Pre-handled in Week 3 `resolveEntity` (FTS first, embedding fallback). |
| 20 | No UI for bot rename | **Solved by C1** — `/setname <Имя>` in Telegram. |

Additional Week-5-specific edge cases:
| Case | Handled by |
|---|---|
| User with no patterns yet (new user) | A2/A3 detectors return empty arrays; A6 `runForUser` returns `{candidatesFound:0, candidatesAfterFilter:0, nudgesDelivered:0}`. |
| Berik's flag flipped mid-conversation | `isV2MemoryEnabled` reads env each call — works with restart. F1 doc explains redeploy requirement. |
| Claude API key missing in test env | All Claude calls are best-effort try/catch — no test should depend on Claude availability. |
| `prisma.insight.findFirst` with `metadata: { path: ['entityId'], equals: ... }` requires JSONB index — without it, full table scan | Acceptable Week 5 (Berik only, low row count). Index → Week 6 backlog if perf becomes an issue. |
| `lib/tz.ts.localHour` returns 24 on edge — DND off-by-one | `gate1_DND` uses `h >= 8 && h < 22`; `localHour` returns 0–23. No off-by-one. |
| `Insight.metadata` field exists in schema | Verified by Week 4/5 — existing column. F1 SMOKE includes `\d "Insight"` check optionally. |
| `prisma.yearlyGoal` `updatedAt` may be null for legacy rows | A3 wraps each goal in per-item try/catch; null `updatedAt` → cast → NaN → `daysSilent` NaN → `>= 14` is false → skipped. Safe. |
| Tool `suggest_goal` user confirms but `YearlyGoal` schema requires fields we didn't set | Schema check: `year`, `area`, `title`, `status`, `userId` set explicitly. Will revisit in B3 testing — if any required field missing in current prod schema, B3 step 5 `npx tsc --noEmit` will fail loudly. |
| Telegram `/setname` invoked by user who never `/start`-ed (no `Integration`) | C1 calls `findOrCreateUser` first (same pattern as `/start`) — creates account on-the-fly, idempotent. |

### 6. Rollback Path

Documented in F1 (`docs/SMOKE-v2-week5.md`):
- Single Railway env flip: `FEATURE_V2_MEMORY=none` and `FEATURE_V2_PROACTIVITY=none`.
- Auto-redeploy → instant.
- Old `captureMemory` + `extractFromTranscript` paths preserved bit-identical in `captureInBackground` (D3 test asserts).
- v2 tables (Entity/EntityRelationship/Pattern/MoodSnapshot/BotIdentity/Insight) — leave data in place; no destructive rollback needed.
- New agent tools (`remember_entity`, `link_relationship`, `suggest_goal`) remain in registry but: (a) the orchestrator's chat path can ignore them — they are pulled into the agent loop via `runAgent`; agent will simply rarely choose them if memory-grounded enrichment block is absent (flag off → no prompt cue); (b) for full surgical disable, gate them out of `agentToolSchemasForUser` with a flag check (Week 6 enhancement — not required for Week 5 rollback). For Week 5, leaving them callable is intentional: even when flag off they write to v2 tables which is **safe** because old reader path doesn't depend on them.
- `/setname` command remains active regardless of flag. This is intentional — bot identity change is harmless when flag is off (read by enrichment which only runs when flag on; `User.assistantStyle` sync runs through `bot-identity.ts` which doesn't affect the bot when flag off). If even this is undesirable: remove the `bot.command('setname', ...)` block (single revert).

---

## Execution Handoff

**Plan complete.** Save this content verbatim to `docs/superpowers/plans/2026-05-31-v2-week5-proactivity-wiring.md`.

**Summary:** 17 atomic tasks, ~116 numbered TDD steps. Builds 1 engine module (5 detectors + 4 gates + nudge generator + orchestrator + singleton), 3 agent tools, 1 Telegram command, 1 inbound capture helper, 1 pure enrichment helper, and threads them into 2 existing orchestrators (`jarvis-orchestrator.ts` + `proactive-scheduler.ts`) behind feature flags. No schema changes. Old chat pipeline behaves bit-identically when flags are off.

**Two execution options:**

**1. Subagent-Driven (recommended for this week — biggest risk surface).** Use `superpowers:subagent-driven-development`. Manual review checkpoint between each section (A→B→C→D→E→F→G) since this is the first behavioural change week.

**2. Inline execution** via `superpowers:executing-plans`. Compress with a pause/review after D3 (orchestrator wiring) and again after E1 (scheduler wiring) since those are the two production-touching commits.

**Which approach?**

---

## Reporting back

- **Plan path (intended):** `/Users/berikkurmangoliev/Desktop/LifeOS/docs/superpowers/plans/2026-05-31-v2-week5-proactivity-wiring.md` — **I am in read-only mode and cannot save this file**. The full plan content is in this assistant message above. The parent agent (or Berik) should save it verbatim to that path.
- **Approximate line count:** ~1,650 lines of plan text (within scope; somewhat denser than Week 4 because Section A engine logic compresses well via numbered tasks and the wiring sections D/E/F deliberately ship as **single-purpose atomic commits** rather than padded-out subdivisions — this matches the locked decision that Week 5 = wiring week, not architectural week).
- **Task count:** **17 atomic tasks** (A1–A6, B1–B4, C1, D1–D3, E1, F1, G1). Within target 14–17 range.
- **Total TDD step count:** **~116 numbered steps** (average 6.8 per task; A5 and A6 at 8 each due to template+singleton bundling; D3 at 8 due to multi-edit integration).
- **Files this plan creates:** 14 new files (4 engine, 1 capture, 1 enrichment, 6 tool files, 2 new structural test files for orchestrator/scheduler wiring, 1 telegram test, 1 SMOKE doc). 5 existing files modified (`tools/index.ts`, `telegram-bot.ts`, `jarvis-orchestrator.ts`, `proactive-scheduler.ts`, `docs/plan/v2-memory-proactivity-scope.md`).
- **Key compliance properties:** zero `vi.mock` (verified in every task + G1); all pure helpers exported and unit-tested without DB/Claude; all Claude calls best-effort with safe defaults (template fallback for nudges); all wiring guarded by `isV2MemoryEnabled`/`isV2ProactivityEnabled` with old path bit-identical when off; dual-write preserved with explicit structural assertion (D3 Step 5); rollback documented as single ENV flip; one atomic commit per task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer; conventional commits `feat(v2-proactivity):` / `feat(v2-tools):` / `feat(v2-wiring):` / `feat(v2-telegram):` / `docs(v2-rollout):` per locked decisions.
