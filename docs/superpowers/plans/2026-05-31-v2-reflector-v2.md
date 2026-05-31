# v2 — Reflector v2 (Cross-Tier Synthesis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synthesize all v2 tiers (axes/traits/feedback/mood/skills/entity/procedural) + a legacy life-summary into ONE keystone insight — weekly (deep) and event-triggered (pulse) — feeding the EXISTING Insight store.

**Architecture:** A new `reflector-v2` service reads every v2 tier best-effort via its public store, Claude-sonnet synthesises one keystone `{message, rationale, severity, scopeTheme, action?}`, and writes it as an `Insight` row (`source='reflector_v2'`) via the EXISTING `persistCandidates` — so delivery, TTL, supersede, cooldown, quiet-hours and ≤1-push are all reused. No new table/migration.

**Tech Stack:** TypeScript strict, Prisma 6.19 + Postgres (read-only reuse, no schema change), Anthropic sonnet, vitest (pure unit + structural readFileSync+grep, zero vi.mock), feature flag `isV2ReflectorEnabled`.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-reflector-v2-design.md` (approved by Berik 2026-05-31).

---

## CRITICAL repo facts (read before any task)
- Work on branch **`main`** in **`/Users/berikkurmangoliev/Desktop/LifeOS`** (NOT the worktree). Start EVERY bash command with `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && ...` (cwd resets).
- **NO Prisma schema change / migration.** Keystones are `Insight` rows. `.env` `DATABASE_URL` is PRODUCTION — never run `prisma migrate`/`db push`. (No `prisma generate` needed either — no schema change.)
- Commit per step, LOCAL only (never `git push`), heredoc message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Commands: `npx tsc --noEmit`, `npx vitest run <path>`, `npx vitest run`.
- **Verified signatures (the implementer should still open each file to confirm before calling):**
  - `persistCandidates(userId: string, candidates: InsightCandidate[], now?: Date): Promise<{created, superseded}>` — `src/services/insight-store.ts`.
  - `InsightCandidate` (in `src/services/insight-core.ts`): `{ kind: string; scope: string; severity: number; message: string; rationale?: string; suggestedAction?: unknown; source: InsightSource; dismissKey?: string; ttlDays?: number }`. `InsightSource` is a string union (existing values include `'reflector'`, `'proactive_insights'`, `'proactive_notifications'`).
  - `getUserAxesStore().getAxes(userId)` → `{selfDiscipline, emotionalOpenness, conflictTolerance, introspectionDepth, signalCount, lastSignalAt}` — `src/services/user-axes/index.ts`.
  - `getBotTraitsStore().getTraits(userId)` → `BotTraits {warmth, directness, humor, playfulness, relationshipDepth}` — `src/services/bot-traits/index.ts`.
  - `getFeedbackStore().recentCorrections(userId, limit?)` → `Array<{styleNote: string|null; dimension; valence; signalType; recordedAt}>` — `src/services/feedback/index.ts`.
  - `getEmotionalMemory().getMoodTimeline(userId, sinceDays)` → `Array<{date, valence, emotion}>`; `.detectMoodShift(userId)` → `{shifted, direction?, magnitude?, sinceDays?} | null` — singleton `getEmotionalMemory()` in `src/services/emotional-memory.singleton.ts`.
  - `getHermesStore().listSkills(userId)` → `SkillDefinition[]` (`.name`, `.useCount`) — `src/services/hermes/index.ts`.
  - `getEntityGraph().staleEntities(userId, sinceDays, minImportance?)` → `Entity[]` — `src/services/entity-graph/index.ts` (accessor `getEntityGraph()`).
  - `getProceduralMemory()...getActivePatterns(userId, opts?)` → `Pattern[]` — `src/services/procedural-memory.ts` (find its singleton accessor).
  - `runReflectorDaily` (its localDay gate) in `src/services/reflector-service.ts`; scheduler call site ~`proactive-scheduler.ts:222`.

## File Structure
| File | Responsibility |
|---|---|
| `src/services/reflector-v2/types.ts` | types + pure helpers (significanceScore, summarise, parseKeystone, shouldFireEvent) |
| `src/services/reflector-v2/gather-facts.ts` | best-effort cross-tier read → ReflectorV2Facts |
| `src/services/reflector-v2/synthesize.ts` | Claude sonnet → Keystone |
| `src/services/reflector-v2/index.ts` | runWeekly + runEventCheck (+ persistCandidates) + re-exports |
| `src/services/insight-core.ts` | add `'reflector_v2'` to `InsightSource` union |
| `src/lib/feature-flags.ts` | `isV2ReflectorEnabled` |
| `src/services/proactive-scheduler.ts` | wire runWeekly + runEventCheck (gated) |
| `src/__integration__/v2-reflector-flow.test.ts` | structural integration |

---

## Task B1: reflector-v2/types.ts + pure helpers

**Files:**
- Create: `packages/server/src/services/reflector-v2/types.ts`
- Test: `packages/server/src/services/reflector-v2/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/reflector-v2/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  significanceScore,
  summariseFactsForPrompt,
  parseKeystone,
  shouldFireEvent,
  EVENT_THRESHOLD,
  type ReflectorV2Facts,
} from './types.js';

const baseLegacy = {
  monthlyBurn: 0, monthlyIncome: 0, habitConsistency: 1,
  goalsBehind: 0, tasksStale: 0, budgetPct: 0,
};

describe('significanceScore', () => {
  it('low when everything is fine', () => {
    const f: ReflectorV2Facts = { legacy: baseLegacy };
    expect(significanceScore(f)).toBeLessThan(EVENT_THRESHOLD);
  });
  it('high when multiple tiers point negative (compound signal)', () => {
    const f: ReflectorV2Facts = {
      moodTrend: { current: -0.4, deltaWeek: -0.4, shift: true },
      legacy: { ...baseLegacy, habitConsistency: 0.2, budgetPct: 0.95, goalsBehind: 2, tasksStale: 5 },
    };
    expect(significanceScore(f)).toBeGreaterThanOrEqual(EVENT_THRESHOLD);
  });
  it('clamped to [0,1]', () => {
    const f: ReflectorV2Facts = {
      moodTrend: { current: -1, deltaWeek: -1, shift: true },
      legacy: { ...baseLegacy, habitConsistency: 0, budgetPct: 2, goalsBehind: 9, tasksStale: 99 },
    };
    const s = significanceScore(f);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('shouldFireEvent', () => {
  it('mirrors significanceScore vs threshold', () => {
    const lo: ReflectorV2Facts = { legacy: baseLegacy };
    expect(shouldFireEvent(lo)).toBe(false);
  });
});

describe('summariseFactsForPrompt', () => {
  it('includes present tiers and omits absent ones', () => {
    const f: ReflectorV2Facts = {
      axes: { selfDiscipline: 0.3, emotionalOpenness: 0.7, conflictTolerance: 0.4, introspectionDepth: 0.5 },
      legacy: baseLegacy,
    };
    const out = summariseFactsForPrompt(f);
    expect(out).toMatch(/self.?discipline|self_discipline|self-discipline/i);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('parseKeystone', () => {
  it('parses a valid keystone', () => {
    const k = parseKeystone(JSON.stringify({
      message: 'Сосредоточься на сне', rationale: 'mood↓ + late', severity: 7,
      scopeTheme: 'health', suggestedAction: null,
    }));
    expect(k?.message).toBe('Сосредоточься на сне');
    expect(k?.severity).toBe(7);
    expect(k?.scopeTheme).toBe('health');
  });
  it('strips fences and clamps severity', () => {
    const k = parseKeystone('```json\n{"message":"x","rationale":"y","severity":99,"scopeTheme":"goals"}\n```');
    expect(k?.severity).toBe(10);
  });
  it('returns null on garbage / missing fields', () => {
    expect(parseKeystone('not json')).toBeNull();
    expect(parseKeystone(JSON.stringify({ message: 'x' }))).toBeNull();
    expect(parseKeystone('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types.ts**

Create `packages/server/src/services/reflector-v2/types.ts`:
```ts
/**
 * Reflector v2 — cross-tier synthesis types + pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-reflector-v2-design.md
 *
 * Pure helpers (significanceScore, shouldFireEvent, summariseFactsForPrompt,
 * parseKeystone) are exported for unit testing without DB/Claude.
 */

export interface ReflectorV2Facts {
  axes?: {
    selfDiscipline: number; emotionalOpenness: number;
    conflictTolerance: number; introspectionDepth: number;
  } | null;
  traits?: {
    warmth: number; directness: number; humor: number;
    playfulness: number; relationshipDepth: number;
  } | null;
  moodTrend?: { current: number; deltaWeek: number; shift: boolean } | null;
  recentCorrections?: Array<{ styleNote: string | null; dimension: string }>;
  skills?: Array<{ name: string; useCount: number }>;
  staleEntities?: Array<{ name: string; type: string; gapDays: number }>;
  patterns?: Array<{ kind: string; summary: string }>;
  legacy: {
    monthlyBurn: number; monthlyIncome: number; habitConsistency: number;
    goalsBehind: number; tasksStale: number; budgetPct: number;
  };
}

export interface Keystone {
  message: string;
  rationale: string;
  severity: number;       // 1..10
  scopeTheme: string;     // 'finance'|'health'|'habits'|'goals'|'identity'|'social'|'general'
  suggestedAction?: unknown;
}

export const EVENT_THRESHOLD = 0.6;

const clamp01 = (n: number): number =>
  Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n));

/**
 * Cross-tier significance for the EVENT trigger, 0..1. Rewards COMPOUND
 * negative signals — multiple tiers pointing the same bad direction.
 * Components (each 0..1, averaged with weights):
 *   - mood falling     (moodTrend.deltaWeek < 0)            w=0.30
 *   - habit collapse   (1 - habitConsistency)               w=0.25
 *   - budget pressure  (budgetPct over 0.8 → ramps to 1)    w=0.20
 *   - goals behind     (goalsBehind capped at 3)            w=0.15
 *   - stale tasks      (tasksStale capped at 5)             w=0.10
 */
export function significanceScore(f: ReflectorV2Facts): number {
  const moodDrop = f.moodTrend ? clamp01(-(f.moodTrend.deltaWeek)) : 0;
  const habitGap = clamp01(1 - (f.legacy.habitConsistency ?? 1));
  const budget = clamp01((((f.legacy.budgetPct ?? 0) - 0.8) / 0.2));
  const goals = clamp01((f.legacy.goalsBehind ?? 0) / 3);
  const tasks = clamp01((f.legacy.tasksStale ?? 0) / 5);
  const score =
    0.30 * moodDrop + 0.25 * habitGap + 0.20 * budget +
    0.15 * goals + 0.10 * tasks;
  return clamp01(score);
}

export function shouldFireEvent(f: ReflectorV2Facts): boolean {
  return significanceScore(f) >= EVENT_THRESHOLD;
}

/** Compact, human-readable fact block for the synthesis prompt. Omits
 *  absent tiers so the model isn't told about data we don't have. */
export function summariseFactsForPrompt(f: ReflectorV2Facts): string {
  const lines: string[] = [];
  if (f.axes) {
    lines.push(
      `Личность(axes): self-discipline=${f.axes.selfDiscipline.toFixed(2)}, ` +
      `emotional-openness=${f.axes.emotionalOpenness.toFixed(2)}, ` +
      `conflict-tolerance=${f.axes.conflictTolerance.toFixed(2)}, ` +
      `introspection=${f.axes.introspectionDepth.toFixed(2)}`,
    );
  }
  if (f.traits) {
    lines.push(
      `Тон бота(traits): warmth=${f.traits.warmth.toFixed(2)}, ` +
      `directness=${f.traits.directness.toFixed(2)}, depth=${f.traits.relationshipDepth.toFixed(2)}`,
    );
  }
  if (f.moodTrend) {
    lines.push(
      `Настроение: текущее=${f.moodTrend.current.toFixed(2)}, ` +
      `Δнеделя=${f.moodTrend.deltaWeek.toFixed(2)}${f.moodTrend.shift ? ' (сдвиг!)' : ''}`,
    );
  }
  if (f.recentCorrections && f.recentCorrections.length) {
    const notes = f.recentCorrections
      .map((c) => c.styleNote).filter(Boolean).slice(0, 3).join('; ');
    if (notes) lines.push(`Недавние коррекции стиля: ${notes}`);
  }
  if (f.skills && f.skills.length) {
    lines.push(`Навыки: ${f.skills.map((s) => `${s.name}(${s.useCount})`).slice(0, 5).join(', ')}`);
  }
  if (f.staleEntities && f.staleEntities.length) {
    lines.push(`Заброшенные связи: ${f.staleEntities.map((e) => `${e.name}(${e.gapDays}д)`).slice(0, 3).join(', ')}`);
  }
  if (f.patterns && f.patterns.length) {
    lines.push(`Паттерны: ${f.patterns.map((p) => p.summary).slice(0, 3).join('; ')}`);
  }
  lines.push(
    `Жизнь: доход/мес=${Math.round(f.legacy.monthlyIncome)}, ` +
    `трата/мес=${Math.round(f.legacy.monthlyBurn)}, ` +
    `привычки=${(f.legacy.habitConsistency * 100).toFixed(0)}%, ` +
    `целей-позади=${f.legacy.goalsBehind}, задач-просрочено=${f.legacy.tasksStale}, ` +
    `бюджет=${(f.legacy.budgetPct * 100).toFixed(0)}%`,
  );
  return lines.join('\n');
}

const THEMES: ReadonlySet<string> = new Set([
  'finance', 'health', 'habits', 'goals', 'identity', 'social', 'general',
]);

/** Defensive parser for the sonnet keystone JSON. Never throws → null. */
export function parseKeystone(raw: string): Keystone | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.message !== 'string' || typeof o.rationale !== 'string') return null;
  if (typeof o.severity !== 'number') return null;
  const severity = Math.max(1, Math.min(10, Math.round(o.severity)));
  const scopeTheme =
    typeof o.scopeTheme === 'string' && THEMES.has(o.scopeTheme)
      ? o.scopeTheme : 'general';
  return {
    message: o.message.slice(0, 1000),
    rationale: o.rationale.slice(0, 280),
    severity,
    scopeTheme,
    suggestedAction: o.suggestedAction ?? null,
  };
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/reflector-v2/types.ts src/services/reflector-v2/types.test.ts
git commit -F - <<'EOF'
feat(v2-reflector): types + pure helpers (B1)

ReflectorV2Facts/Keystone; significanceScore (compound cross-tier signal),
shouldFireEvent (>=0.6), summariseFactsForPrompt (omits absent tiers),
parseKeystone (defensive, never throws, clamps severity).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B2: gather-facts.ts — cross-tier best-effort read

**Files:**
- Create: `packages/server/src/services/reflector-v2/gather-facts.ts`
- Test: `packages/server/src/services/reflector-v2/gather-facts.test.ts`

**Before coding:** open each consumer store file (listed in CRITICAL repo facts) and confirm the accessor name + method signature. In particular find the procedural-memory singleton accessor (e.g. `getProceduralMemory()` or similar in `procedural-memory.singleton.ts` / `procedural-memory.ts`) and the entity-graph accessor `getEntityGraph()`. If an accessor name differs, use the real one (do NOT invent).

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/reflector-v2/gather-facts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/gather-facts.ts'), 'utf-8');

describe('gather-facts structure', () => {
  it('exports gatherFacts', () => {
    expect(SRC).toMatch(/export async function gatherFacts/);
  });
  it('reads the v2 tiers via their stores', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.getAxes/);
    expect(SRC).toMatch(/getBotTraitsStore\(\)\.getTraits/);
    expect(SRC).toMatch(/recentCorrections/);
    expect(SRC).toMatch(/getMoodTimeline|detectMoodShift/);
    expect(SRC).toMatch(/listSkills/);
    expect(SRC).toMatch(/staleEntities/);
    expect(SRC).toMatch(/getActivePatterns/);
  });
  it('computes a legacy summary (finance/habits/tasks)', () => {
    expect(SRC).toMatch(/legacy/);
    expect(SRC).toMatch(/monthlyBurn/);
  });
  it('is best-effort — each tier wrapped, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/gather-facts.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement gather-facts.ts**

Create `packages/server/src/services/reflector-v2/gather-facts.ts`. Each tier read is wrapped in its own try/catch so one failure omits only that field. Legacy is computed inline with light prisma queries (no dependency on any unexported helper):
```ts
/**
 * Reflector v2 — best-effort cross-tier fact gathering. Each tier read is
 * isolated: a failure omits only that field. `legacy` is always present
 * (computed inline). Never throws.
 */

import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import { getBotTraitsStore } from '../bot-traits/index.js';
import { getFeedbackStore } from '../feedback/index.js';
import { getEmotionalMemory } from '../emotional-memory.singleton.js';
import { getHermesStore } from '../hermes/index.js';
import { getEntityGraph } from '../entity-graph/index.js';
import { getProceduralMemory } from '../procedural-memory.js';
import type { ReflectorV2Facts } from './types.js';

const DAY = 24 * 60 * 60 * 1000;

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[reflector-v2:gather:${label}] failed:`,
      err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function computeLegacy(userId: string, now: Date): Promise<ReflectorV2Facts['legacy']> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  try {
    const [income, expense, habitLogs, habits, staleTasks, budgets] = await Promise.all([
      prisma.income.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: since30 } } }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: since30 } } }),
      prisma.habitLog.count({ where: { userId, date: { gte: since30 }, completed: true } }),
      prisma.habit.count({ where: { userId, active: true } }),
      prisma.task.count({ where: { userId, completed: false, date: { lt: new Date(now.getTime() - 2 * DAY) } } }),
      prisma.budgetLimit.aggregate({ _sum: { monthlyLimit: true }, where: { userId, month: now.getUTCMonth() + 1, year: now.getUTCFullYear() } }),
    ]);
    const monthlyIncome = income._sum.amount ?? 0;
    const monthlyBurn = expense._sum.amount ?? 0;
    // habit consistency ≈ completed logs / (active habits × 30), capped at 1
    const denom = Math.max(1, (habits || 1) * 30);
    const habitConsistency = Math.max(0, Math.min(1, habitLogs / denom));
    const limit = budgets._sum.monthlyLimit ?? 0;
    const budgetPct = limit > 0 ? monthlyBurn / limit : 0;
    return {
      monthlyBurn, monthlyIncome, habitConsistency,
      goalsBehind: 0, tasksStale: staleTasks, budgetPct,
    };
  } catch (err) {
    console.warn('[reflector-v2:gather:legacy] failed:', err);
    return { monthlyBurn: 0, monthlyIncome: 0, habitConsistency: 1, goalsBehind: 0, tasksStale: 0, budgetPct: 0 };
  }
}

export async function gatherFacts(userId: string, now: Date = new Date()): Promise<ReflectorV2Facts> {
  const legacy = await computeLegacy(userId, now);

  const axesRaw = await safe('axes', () => getUserAxesStore().getAxes(userId));
  const axes = axesRaw ? {
    selfDiscipline: axesRaw.selfDiscipline,
    emotionalOpenness: axesRaw.emotionalOpenness,
    conflictTolerance: axesRaw.conflictTolerance,
    introspectionDepth: axesRaw.introspectionDepth,
  } : null;

  const traitsRaw = await safe('traits', () => getBotTraitsStore().getTraits(userId));
  const traits = traitsRaw ? {
    warmth: traitsRaw.warmth, directness: traitsRaw.directness,
    humor: traitsRaw.humor, playfulness: traitsRaw.playfulness,
    relationshipDepth: traitsRaw.relationshipDepth,
  } : null;

  const emo = getEmotionalMemory();
  const timeline = await safe('mood', () => emo.getMoodTimeline(userId, 14));
  const shift = await safe('moodShift', () => emo.detectMoodShift(userId));
  let moodTrend: ReflectorV2Facts['moodTrend'] = null;
  if (timeline && timeline.length > 0) {
    const recent = timeline.slice(-7);
    const prior = timeline.slice(0, Math.max(0, timeline.length - 7));
    const avg = (a: Array<{ valence: number }>) =>
      a.length ? a.reduce((s, x) => s + x.valence, 0) / a.length : 0;
    const current = avg(recent);
    const deltaWeek = current - (prior.length ? avg(prior) : current);
    moodTrend = { current, deltaWeek, shift: !!(shift && shift.shifted) };
  }

  const corrections = await safe('feedback', () => getFeedbackStore().recentCorrections(userId, 5));
  const recentCorrections = (corrections ?? []).map((c) => ({
    styleNote: c.styleNote, dimension: c.dimension,
  }));

  const skillRows = await safe('skills', () => getHermesStore().listSkills(userId));
  const skills = (skillRows ?? []).map((s) => ({ name: s.name, useCount: s.useCount }));

  const stale = await safe('entities', () => getEntityGraph().staleEntities(userId, 30, 5));
  const staleEntities = (stale ?? []).slice(0, 5).map((e: { name: string; type: string; lastSeenAt?: Date | null }) => ({
    name: e.name, type: e.type,
    gapDays: e.lastSeenAt ? Math.round((now.getTime() - new Date(e.lastSeenAt).getTime()) / DAY) : 0,
  }));

  const patternRows = await safe('patterns', () => getProceduralMemory().getActivePatterns(userId));
  const patterns = (patternRows ?? []).slice(0, 5).map((p: { kind: string; summary?: string }) => ({
    kind: p.kind, summary: p.summary ?? p.kind,
  }));

  return { axes, traits, moodTrend, recentCorrections, skills, staleEntities, patterns, legacy };
}
```
NOTE: if `getProceduralMemory`, `getEntityGraph`, or `getEmotionalMemory` accessor names/paths differ, fix the import to the real one (open the file). If `Pattern` has no `summary` field, map from whatever short text field it has (e.g. `payload`/`kind`) — keep it a short string. If `Entity` lacks `lastSeenAt`, set `gapDays: 0`. The structural test only checks the calls exist; tsc must pass with the REAL types.

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/gather-facts.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. If a store method/type mismatch appears, fix to the real signature (do NOT loosen with `any` unless the surrounding code already does).

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/reflector-v2/gather-facts.ts src/services/reflector-v2/gather-facts.test.ts
git commit -F - <<'EOF'
feat(v2-reflector): gatherFacts cross-tier best-effort read (B2)

Reads axes/traits/mood-trend/feedback/skills/stale-entities/patterns via
their existing stores (each isolated try/catch → omit on fail) + inline
legacy finance/habit/task summary. Never throws.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B3: synthesize.ts — Claude sonnet keystone

**Files:**
- Create: `packages/server/src/services/reflector-v2/synthesize.ts`
- Test: `packages/server/src/services/reflector-v2/synthesize.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/reflector-v2/synthesize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/synthesize.ts'), 'utf-8');

describe('synthesize structure', () => {
  it('exports synthesizeKeystone', () => {
    expect(SRC).toMatch(/export async function synthesizeKeystone/);
  });
  it('uses sonnet + summariseFactsForPrompt + parseKeystone', () => {
    expect(SRC).toMatch(/MODELS\.sonnet/);
    expect(SRC).toMatch(/summariseFactsForPrompt/);
    expect(SRC).toMatch(/parseKeystone/);
  });
  it('asks for ONE keystone linking >=2 tiers + one concrete step', () => {
    expect(SRC).toMatch(/keystone|главн/i);
  });
  it('best-effort — returns null on failure, never throws', () => {
    expect(SRC).toMatch(/return null/);
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/synthesize.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement synthesize.ts**

Create `packages/server/src/services/reflector-v2/synthesize.ts`:
```ts
/**
 * Reflector v2 — Claude sonnet cross-tier synthesis → ONE keystone.
 * Best-effort: any failure → null (caller emits nothing; never fabricates).
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { summariseFactsForPrompt, parseKeystone, type ReflectorV2Facts, type Keystone } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const SYS = `Ты — рефлексирующий AI-друг LifeOS. Тебе дают КРОСС-СРЕЗ жизни
пользователя по разным слоям (личность, тон, настроение, привычки, финансы,
цели, навыки, связи). Выдай ОДИН самый важный keystone-вывод за период:
- что ГЛАВНОЕ сейчас,
- ПОЧЕМУ (обязательно свяжи минимум ДВА слоя — напр. «настроение просело И ты
  забросил привычку чтения, а это твоя годовая цель»),
- и ОДИН конкретный выполнимый шаг.
Учитывай личность (axes) и подстраивай тон. Будь конкретным, без воды.
Верни ТОЛЬКО валидный JSON:
{"message":"...","rationale":"короткое почему","severity":1-10,
"scopeTheme":"finance|health|habits|goals|identity|social|general",
"suggestedAction":null}
Без markdown, без пояснений.`;

export async function synthesizeKeystone(
  facts: ReflectorV2Facts,
  style: string,
): Promise<Keystone | null> {
  try {
    const content =
      `Стиль ассистента: ${style}.\n\nСрез жизни:\n${summariseFactsForPrompt(facts)}`;
    const res = await anthropic.messages.create({
      model: MODELS.sonnet,
      max_tokens: 600,
      system: SYS,
      messages: [{ role: 'user', content }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return null;
    return parseKeystone(block.text);
  } catch (err) {
    console.warn('[reflector-v2:synthesize] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}
```
NOTE: confirm `MODELS.sonnet` exists in `src/lib/models.js` (B-phase used `MODELS.haiku`; sonnet should be there too — if the key is named differently, use the real one).

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/synthesize.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/reflector-v2/synthesize.ts src/services/reflector-v2/synthesize.test.ts
git commit -F - <<'EOF'
feat(v2-reflector): synthesizeKeystone sonnet synthesis (B3)

Sonnet given the cross-tier fact summary → ONE keystone {message,
rationale, severity, scopeTheme} linking >=2 tiers + one concrete step.
Best-effort: null on any failure (never fabricates).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B4: index.ts — runWeekly + runEventCheck + persistCandidates

**Files:**
- Modify: `packages/server/src/services/insight-core.ts` (add `'reflector_v2'` to `InsightSource`)
- Create: `packages/server/src/services/reflector-v2/index.ts`
- Test: `packages/server/src/services/reflector-v2/index.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/reflector-v2/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const CORE = readFileSync(
  join(process.cwd(), 'src/services/insight-core.ts'), 'utf-8');

describe('reflector-v2 index', () => {
  it('exports runWeekly and runEventCheck', () => {
    expect(SRC).toMatch(/export async function runWeekly/);
    expect(SRC).toMatch(/export async function runEventCheck/);
  });
  it('weekly is rate-gated (rolling 7d) and event uses shouldFireEvent', () => {
    expect(SRC).toMatch(/reflector_v2_weekly/);
    expect(SRC).toMatch(/shouldFireEvent/);
  });
  it('persists via the existing insight store with source reflector_v2', () => {
    expect(SRC).toMatch(/persistCandidates/);
    expect(SRC).toMatch(/'reflector_v2'/);
  });
  it('best-effort — wrapped, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });
});

describe('InsightSource extended', () => {
  it("includes 'reflector_v2'", () => {
    expect(CORE).toMatch(/reflector_v2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `'reflector_v2'` to the InsightSource union**

In `src/services/insight-core.ts`, find the `InsightSource` type (a string union with values like `'reflector' | 'proactive_insights' | 'proactive_notifications'`). Append `| 'reflector_v2'` to it. (Open the file and edit the actual union — its exact location/values may differ; just add the new member, keep all existing ones.)

- [ ] **Step 4: Implement index.ts**

Create `packages/server/src/services/reflector-v2/index.ts`:
```ts
/**
 * Reflector v2 — orchestrators. Both run best-effort and write keystones
 * to the EXISTING Insight store (source='reflector_v2'); delivery, TTL,
 * supersede, cooldown, quiet-hours and <=1-push are inherited.
 */

import { prisma } from '../../lib/prisma.js';
import { persistCandidates } from '../insight-store.js';
import type { InsightCandidate } from '../insight-core.js';
import { gatherFacts } from './gather-facts.js';
import { synthesizeKeystone } from './synthesize.js';
import { shouldFireEvent, type Keystone } from './types.js';

export { gatherFacts } from './gather-facts.js';
export { synthesizeKeystone } from './synthesize.js';
export * from './types.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function userStyle(userId: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId }, select: { assistantStyle: true },
    });
    return u?.assistantStyle ?? 'friendly';
  } catch {
    return 'friendly';
  }
}

function toCandidate(k: Keystone, kind: string, scope: string): InsightCandidate {
  return {
    kind,
    scope,
    severity: k.severity,
    message: k.message,
    rationale: k.rationale,
    suggestedAction: k.suggestedAction ?? undefined,
    source: 'reflector_v2',
    ttlDays: 7,
  };
}

/** Weekly deep synthesis. Rolling-7-day gate: at most one weekly keystone
 *  per user per 7 days. Best-effort. */
export async function runWeekly(userId: string, now: Date = new Date()): Promise<{ emitted: boolean }> {
  try {
    const since = new Date(now.getTime() - WEEK_MS);
    const already = await prisma.insight.count({
      where: { userId, source: 'reflector_v2', kind: 'reflector_v2_weekly', createdAt: { gte: since } },
    });
    if (already > 0) return { emitted: false };

    const facts = await gatherFacts(userId, now);
    const keystone = await synthesizeKeystone(facts, await userStyle(userId));
    if (!keystone) return { emitted: false };

    await persistCandidates(
      userId,
      [toCandidate(keystone, 'reflector_v2_weekly', 'reflector_v2:week')],
      now,
    );
    return { emitted: true };
  } catch (err) {
    console.warn('[reflector-v2:weekly] failed:', err);
    return { emitted: false };
  }
}

/** Event-triggered pulse. Fires only when the compound cross-tier signal
 *  crosses the threshold. The Insight R10 cooldown throttles repeats by
 *  kind+scope. Best-effort. */
export async function runEventCheck(userId: string, now: Date = new Date()): Promise<{ emitted: boolean }> {
  try {
    const facts = await gatherFacts(userId, now);
    if (!shouldFireEvent(facts)) return { emitted: false };

    const keystone = await synthesizeKeystone(facts, await userStyle(userId));
    if (!keystone) return { emitted: false };

    await persistCandidates(
      userId,
      [toCandidate(keystone, 'reflector_v2_event', `reflector_v2:event:${keystone.scopeTheme}`)],
      now,
    );
    return { emitted: true };
  } catch (err) {
    console.warn('[reflector-v2:event] failed:', err);
    return { emitted: false };
  }
}
```
NOTE: confirm `User.assistantStyle` is the field name (CLAUDE.md schema shows `assistantStyle`). If `InsightCandidate.source` is typed and `'reflector_v2'` isn't accepted, you missed Step 3.

- [ ] **Step 5: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/index.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/insight-core.ts src/services/reflector-v2/index.ts src/services/reflector-v2/index.test.ts
git commit -F - <<'EOF'
feat(v2-reflector): runWeekly + runEventCheck orchestrators (B4)

Both gatherFacts → synthesize → persistCandidates(source='reflector_v2')
into the existing Insight store. Weekly: rolling-7d gate. Event: gated by
shouldFireEvent compound signal; R10 cooldown throttles repeats. Adds
'reflector_v2' to InsightSource. Best-effort.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C1: isV2ReflectorEnabled flag + proactive-scheduler wiring

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/services/proactive-scheduler.ts`
- Test: `packages/server/src/services/reflector-v2/wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/reflector-v2/wiring.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2ReflectorEnabled } from '../../lib/feature-flags.js';

const SCHED = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');

describe('isV2ReflectorEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_REFLECTOR; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_REFLECTOR;
    expect(isV2ReflectorEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_REFLECTOR = 'all';
    expect(isV2ReflectorEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_REFLECTOR = 'user-u1,user-u2';
    expect(isV2ReflectorEnabled('u1')).toBe(true);
    expect(isV2ReflectorEnabled('u3')).toBe(false);
  });
});

describe('scheduler wiring', () => {
  it('is gated and calls both runners', () => {
    expect(SCHED).toMatch(/isV2ReflectorEnabled/);
    expect(SCHED).toMatch(/runWeekly/);
    expect(SCHED).toMatch(/runEventCheck/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the feature flag**

In `src/lib/feature-flags.ts`, append after `isV2HermesEnabled`:
```ts
/**
 * Reflector v2 — Per-user gate for cross-tier synthesis. Same shape as
 * isV2HermesEnabled: "all"/"true", "none"/"false"/unset, or "user-X,user-Y".
 */
export function isV2ReflectorEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_REFLECTOR;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Wire into the scheduler**

In `src/services/proactive-scheduler.ts`:
- Add imports near the existing service imports at the top:
```ts
import { runWeekly, runEventCheck } from './reflector-v2/index.js';
import { isV2ReflectorEnabled } from '../lib/feature-flags.js';
```
(If `feature-flags` is already imported with named flags, ADD `isV2ReflectorEnabled` to that existing import line instead of duplicating.)
- Find the per-user line `await runReflectorDaily(userId, new Date());` (~line 222). Immediately AFTER it, add a best-effort gated block:
```ts
        if (isV2ReflectorEnabled(userId)) {
          try {
            await runWeekly(userId, new Date());
            await runEventCheck(userId, new Date());
          } catch (err) {
            console.warn('[reflector-v2:scheduler] failed:', err);
          }
        }
```
(Match the surrounding indentation. Both runners are already internally best-effort; the extra try/catch is defense-in-depth so the scheduler loop can never break.)

- [ ] **Step 5: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/reflector-v2/wiring.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/lib/feature-flags.ts src/services/proactive-scheduler.ts \
  src/services/reflector-v2/wiring.test.ts
git commit -F - <<'EOF'
feat(v2-reflector): isV2ReflectorEnabled flag + scheduler wiring (C1)

Gated per-user. In the per-user scheduler tick (next to runReflectorDaily)
runs runWeekly (rolling-7d gate) + runEventCheck (significance gate),
best-effort. Delivery handled by the existing deliverTopInsight.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task E1: integration test + full verify + progress tracker

**Files:**
- Create: `packages/server/src/__integration__/v2-reflector-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

- [ ] **Step 1: Write the integration test (structural)**

Create `packages/server/src/__integration__/v2-reflector-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const IDX = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');
const GATHER = readFileSync(join(process.cwd(), 'src/services/reflector-v2/gather-facts.ts'), 'utf-8');
const SCHED = readFileSync(join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');

describe('v2 reflector flow — reuses existing insight store', () => {
  it('writes keystones via persistCandidates with source reflector_v2', () => {
    expect(IDX).toMatch(/persistCandidates/);
    expect(IDX).toMatch(/'reflector_v2'/);
  });
  it('no new prisma model — reuses Insight (no schema import of a reflector table)', () => {
    expect(IDX).not.toMatch(/reflectorV2\.create|prisma\.reflector/);
  });
});

describe('v2 reflector flow — cross-tier consumption', () => {
  it('gatherFacts reads >=3 distinct v2 tiers', () => {
    const tiers = ['getAxes', 'getTraits', 'getMoodTimeline', 'recentCorrections', 'listSkills', 'staleEntities', 'getActivePatterns'];
    const hit = tiers.filter((t) => GATHER.includes(t)).length;
    expect(hit).toBeGreaterThanOrEqual(3);
  });
});

describe('v2 reflector flow — wiring', () => {
  it('scheduler runs both reflector-v2 entrypoints, gated', () => {
    expect(SCHED).toContain('isV2ReflectorEnabled');
    expect(SCHED).toContain('runWeekly');
    expect(SCHED).toContain('runEventCheck');
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/__integration__/v2-reflector-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run 2>&1 | tail -20
```
Expected: tsc clean; all tests pass (baseline 1723 + reflector-v2 additions ~25–35). `[...] failed:` / Prisma FK lines in stderr are intentional best-effort logs, not failures — only the final summary line matters. If any test genuinely FAILS, STOP and report BLOCKED.

- [ ] **Step 4: Update the progress tracker**

In `docs/plan/v2-memory-proactivity-scope.md`, add a "Reflector v2 — done" entry mirroring the B1–B4 entries: cross-tier synthesis (axes/traits/feedback/mood/skills/entity/procedural + legacy) → ONE keystone (weekly + event-triggered) via Claude sonnet; reuses the existing Insight store (no new table/migration); flag `isV2ReflectorEnabled` (`FEATURE_V2_REFLECTOR`); files `src/services/reflector-v2/` (types, gather-facts, synthesize, index); ~6 tasks. Match the document's heading/format.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/__integration__/v2-reflector-flow.test.ts \
  /Users/berikkurmangoliev/Desktop/LifeOS/docs/plan/v2-memory-proactivity-scope.md
git commit -F - <<'EOF'
test(v2-reflector): reflector-flow integration + progress tracker (E1)

Structural integration: keystones flow into the existing Insight store
(source='reflector_v2', no new table); gatherFacts reads >=3 v2 tiers;
scheduler runs both entrypoints gated by isV2ReflectorEnabled. Marks
Reflector v2 done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Rollout (AFTER all tasks green — explicit Berik approval per step)
1. **Push** (on "push"): `git push origin main`.
2. **Deploy**: NO migration (reuses Insight). Verify service Online (health 200) + no crash on boot.
3. **Flag**: `FEATURE_V2_REFLECTOR=user-cmp6n0jf90000pf017gv1kukz` (Berik Telegram id — DUAL ACCOUNT, not email id).
4. **SMOKE**: easiest is the EVENT path — when the compound signal is high (e.g. low habit consistency + tight budget already true for Berik), `runEventCheck` fires on the next scheduler tick → a cross-tier keystone arrives in Telegram referencing ≥2 tiers. Or wait for the weekly. Verify the Insight row: `SELECT kind, message FROM "Insight" WHERE userId=... AND source='reflector_v2'`.

---

## Self-Review (against the spec)
**Spec coverage:**
- §1 consume v2 tiers (the gap) → B2 gatherFacts ✓ (E1 asserts ≥3 tiers)
- §2 two modes weekly+event → B4 runWeekly/runEventCheck ✓
- §2 reuse Insight store, no new table → B4 persistCandidates, E1 asserts no new model ✓
- §3 architecture (gather→synth→persist) → B2/B3/B4 ✓
- §4 components → B1–B4 ✓
- §5 wiring + flag → C1 ✓
- §6 best-effort, no spam (inherited R9/R10/R11) → all runners best-effort; reuse store ✓
- §7 no migration → confirmed (no schema task) ✓
- §8 testing (pure + structural + integration, zero vi.mock) → all ✓

**Placeholder scan:** none. The only "verify the real accessor/field name" notes (gather-facts B2, synthesize B3) are explicit guard instructions for store signatures the implementer must confirm by opening the file — not silent placeholders; concrete code is provided for the verified-common case.

**Type consistency:** `ReflectorV2Facts`/`Keystone` defined B1, reused B2/B3/B4. `significanceScore`/`shouldFireEvent`/`summariseFactsForPrompt`/`parseKeystone` B1 → used B3/B4. `gatherFacts(userId, now)` B2 → B4. `synthesizeKeystone(facts, style)` B3 → B4. `persistCandidates(userId, candidates, now)` + `InsightCandidate{source:'reflector_v2'}` consistent B4 (after InsightSource extension). `runWeekly`/`runEventCheck` B4 → C1.

**Total:** 6 tasks (B1–B4, C1, E1). No schema/migration. Mirrors B1–B4 granularity.
```
