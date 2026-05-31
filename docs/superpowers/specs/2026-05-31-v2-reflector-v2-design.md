# v2 — Reflector v2 (Cross-Tier Synthesis) — Design Spec

**Status:** DRAFT → awaiting Berik approval
**Author:** Claude (subagent-driven)
**Date:** 2026-05-31
**Depends on:** v2 tiers A (memory/proactivity) + B1 axes + B2 traits + B3 feedback + B4 skills (all in prod), existing Insight store (Insight/InsightDismissal models, R5/R9/R10/R11 lifecycle)
**Quality bar:** «Умный Джарвис» — no халтура.

---

## 1. Context & Motivation

LifeOS already has a reflection layer — three deterministic engines feeding a
unified Insight store with mature delivery (TTL, supersede, cooldown, quiet
hours, ≤1 push/day, Telegram/Expo):
- `proactive-insights` — tactical daily rules (stale tasks, budget %, events).
- `reflector-core`/`reflector-service` — 3 deep finance/goal truths, daily cron.
- `life-truth-analyzer` — brutal holistic AI analysis, on-demand only.

**The gap:** NONE of them read the v2 brain. Axes (B1), traits (B2),
feedback/CorrectionLog (B3), skills (B4), entity-graph, MoodSnapshot
(emotional-memory), episodic & procedural memory — all invisible to
reflection. Insights are generic ("negative cashflow = crisis for everyone"),
not personalised to *this* user's measured personality, emotional trajectory,
or learned patterns.

**Reflector v2** closes that gap: a cross-tier synthesizer that consumes the
v2 brain and emits ONE keystone insight — personalised (to axes), emotionally
aware (mood trend), feedback- and skill-aware. This is the north-star
culmination: every tier we built, synthesised into proactive daily action,
through one brain.

---

## 2. Scope & Decisions (locked with Berik 2026-05-31)

- ✅ **Cross-tier synthesizer** consuming v2 tiers + legacy summary → ONE
  keystone insight.
- ✅ **Two modes (Berik chose "event + weekly"):**
  - **Weekly synthesis** — deep "вот главное про тебя за неделю + почему +
    один шаг". Idempotent per local week.
  - **Event-triggered** — fires a keystone NOW when a significant cross-tier
    pattern emerges (e.g. mood↓ + habit break + budget tight), gated by a
    significance threshold.
- ✅ **Reuse the existing Insight store + delivery** (`persistCandidates`,
  `deliverTopInsight`). NO new delivery channel, NO new dedup/quiet-hours.
- ✅ **NO new Prisma table.** Keystones are `Insight` rows with
  `source='reflector_v2'`. Idempotency via existing local-day/week gate
  pattern. Zero migration → zero DB-migration risk.
- ✅ **Feature flag** `isV2ReflectorEnabled` (env `FEATURE_V2_REFLECTOR`).
  Per-user, reversible.
- ✅ **Best-effort everywhere** — never throws, never blocks the scheduler;
  a missing/failed tier is omitted; a failed synthesis emits nothing (never
  fabricates).

### Non-Goals
- ❌ New Insight delivery/lifecycle code (reuse R5/R6/R9/R10/R11).
- ❌ Replacing the existing daily reflector / proactive-insights (they stay).
- ❌ New table / migration.
- ❌ Rebuilding KAIROS gates (the Insight store + deliverTopInsight already
  enforce ≤1 push/day + quiet hours; event keystones compete fairly there).
- ❌ Touching B1–B4 internals (read-only consumption via their public stores).

---

## 3. Core Architecture

```
weekly tick (localWeek gate)        per-message/scheduler tick
        │                                   │
   runWeekly(userId)                  runEventCheck(userId)
        │                                   │
        ▼                                   ▼
   gatherFacts(userId) ──────────────────────────────┐
   (best-effort read of every v2 tier + legacy)       │
        │                                              │
        │                              significanceScore(facts) ≥ threshold?
        │                                       │ no → stop
        ▼                                       ▼ yes
   synthesize(facts, style)  ◄───────────────────┘
   (Claude sonnet → ONE keystone {message, rationale, severity, action?})
        │  null on failure → emit nothing
        ▼
   persistCandidates(userId, [keystone], now)   ← EXISTING insight-store
   source='reflector_v2', kind='reflector_v2_keystone', scopeKey=<theme>
        │
        ▼
   EXISTING deliverTopInsight (R6/R9/R10/R11) → Telegram/Expo (≤1/day, quiet-aware)
```

**Why reuse the Insight store:** delivery, dedup (supersede same kind+scope),
cooldown (R10, 3d), TTL (R9, 7d), quiet hours (R11), and ≤1 push/day are all
solved there. A reflector_v2 keystone is just another high-quality candidate;
the store handles competition with existing insights by severity.

**Weekly vs event share `gatherFacts` + `synthesize`** — the only difference is
the trigger gate (localWeek idempotency vs significance threshold) and the
scopeKey/kind nuance (so a weekly keystone and an event keystone don't
supersede each other incorrectly).

---

## 4. Components (`src/services/reflector-v2/`)

### 4.1 `types.ts` — types + pure helpers (unit-tested, no I/O)
```ts
export interface ReflectorV2Facts {
  axes?: { selfDiscipline: number; emotionalOpenness: number;
           conflictTolerance: number; introspectionDepth: number } | null;
  traits?: { warmth: number; directness: number; humor: number;
             playfulness: number; relationshipDepth: number } | null;
  moodTrend?: { current: number; deltaWeek: number; shift: boolean } | null;
  recentCorrections?: Array<{ styleNote: string | null; dimension: string }>;
  skills?: Array<{ name: string; useCount: number }>;
  staleEntities?: Array<{ name: string; type: string; gapDays: number }>;
  patterns?: Array<{ kind: string; summary: string }>;       // procedural
  legacy: { monthlyBurn: number; monthlyIncome: number;
            habitConsistency: number; goalsBehind: number;
            tasksStale: number; budgetPct: number };
}

export interface Keystone {
  message: string;
  rationale: string;        // short "why" (push title)
  severity: number;         // 1..10 (Insight core scale)
  scopeTheme: string;       // 'finance'|'health'|'habits'|'goals'|'identity'|'social'
  suggestedAction?: { action: string; input: Record<string, unknown> } | null;
}

/** Pure: cross-tier significance for the EVENT trigger, 0..1.
 *  Combines: moodTrend.deltaWeek (down), habit drop (legacy.habitConsistency),
 *  budget pressure (legacy.budgetPct), goalsBehind. High when MULTIPLE
 *  tiers point the same negative direction (the "compound" signal). */
export function significanceScore(f: ReflectorV2Facts): number { ... }

export const EVENT_THRESHOLD = 0.6;

/** Pure: render facts into a compact prompt block for synthesize. */
export function summariseFactsForPrompt(f: ReflectorV2Facts): string { ... }

/** Pure: parse the sonnet keystone JSON defensively → Keystone | null. */
export function parseKeystone(raw: string): Keystone | null { ... }
```

### 4.2 `gather-facts.ts` — best-effort cross-tier read
`gatherFacts(userId): Promise<ReflectorV2Facts>` — reads each tier via its
EXISTING public store, each wrapped so a failure → that field omitted:
- axes: `getUserAxesStore().getAxes(userId)`
- traits: `getBotTraitsStore().getTraits(userId)` (+ relationshipDepth)
- moodTrend: emotional-memory `getMoodTimeline` (last 7d avg vs prior) +
  `detectMoodShift`
- recentCorrections: `getFeedbackStore().recentCorrections(userId, 5)`
- skills: `getHermesStore().listSkills(userId)` (name + useCount)
- staleEntities: entity-graph `staleEntities(userId)`
- patterns: procedural-memory `getActivePatterns(userId)`
- legacy: reuse `gatherReflectorFacts` outputs + a small finance/habit/task
  summary (monthlyBurn/income from reflector-service, habitConsistency &
  tasksStale & budgetPct from light queries — mirror proactive-insights).
Returns a fully-formed `ReflectorV2Facts` (legacy always present; tiers
optional). Never throws.

### 4.3 `synthesize.ts` — Claude sonnet keystone
`synthesizeKeystone(facts, style): Promise<Keystone | null>` — sonnet with a
system prompt: "Ты — рефлексирующий друг. Дан кросс-tier снимок жизни юзера.
Выдай ОДИН самый важный keystone-вывод за период: что главное, ПОЧЕМУ (связь
≥2 tier'ов), и ОДИН конкретный шаг. Учитывай личность (axes) и тон (traits).
Верни JSON {message, rationale, severity, scopeTheme, suggestedAction?}."
Best-effort: any failure → null (caller emits nothing). Uses
`summariseFactsForPrompt` + `parseKeystone`.

### 4.4 `detect-event.ts`
`shouldFireEvent(facts): boolean` = `significanceScore(facts) >= EVENT_THRESHOLD`
(thin async-free wrapper kept separate for testing + future tuning).

### 4.5 `index.ts` — orchestrators + singleton-ish
- `runWeekly(userId, now): Promise<{emitted: boolean}>` — gate: only once per
  local week (mirror `runReflectorDaily`'s `localDayStartUTC` → a
  `localWeekStartUTC` check against existing `source='reflector_v2'` weekly
  rows). gatherFacts → synthesize → persistCandidates(kind=
  'reflector_v2_weekly', scopeKey='reflector_v2:week:<localWeek>').
- `runEventCheck(userId, now): Promise<{emitted: boolean}>` — gatherFacts →
  `shouldFireEvent` → synthesize → persistCandidates(kind=
  'reflector_v2_event', scopeKey='reflector_v2:event:'+scopeTheme). The
  existing R10 cooldown (3d per kind+scopeKey) throttles repeats.
- Both best-effort; re-export pure helpers.

---

## 5. Wiring + Flag

- `src/lib/feature-flags.ts` — `isV2ReflectorEnabled(userId)` (same shape as
  `isV2HermesEnabled`; env `FEATURE_V2_REFLECTOR`).
- `proactive-scheduler.ts` per-user loop (next to the existing
  `runReflectorDaily(userId)` call ~line 222): add, gated by
  `isV2ReflectorEnabled(userId)` and best-effort try/catch:
  ```ts
  await runWeekly(userId, now);     // localWeek-gated internally
  await runEventCheck(userId, now); // significance-gated internally
  ```
  Delivery is already handled by the existing `deliverTopInsight(userId)` call
  later in the same tick. No new delivery code.

---

## 6. Safety, dedup, throttle (all REUSED)
- **Best-effort**: every tier read + synthesize + persist wrapped; never throws
  into the scheduler. A failed weekly/event run just emits nothing.
- **No spam**: Insight R9 (supersede same kind+scopeKey) + R10 (3d cooldown) +
  R11 (quiet hours) + ≤1 push/day (R6) — inherited unchanged. Weekly uses a
  week-stable scopeKey (one per week); event uses a theme scopeKey (cooldown
  prevents same-theme repeats).
- **Never fabricate**: synthesize returns null on any failure → no insight.
- **Flag-gated, reversible**: unset `FEATURE_V2_REFLECTOR` → fully inert.
- **Read-only on B1–B4**: consumes their public stores; never writes them.

---

## 7. Data model
**No new table.** Keystones are `Insight` rows: `source='reflector_v2'`,
`kind ∈ {reflector_v2_weekly, reflector_v2_event}`, `scopeKey` as above,
`severity` from the keystone, `message`/`rationale`/`suggestedAction` from the
keystone. Reuses all existing Insight columns + lifecycle.

---

## 8. Testing Strategy (mirror B1–B4)
- **Pure unit** (no I/O): `significanceScore` (compound-signal cases + bounds),
  `summariseFactsForPrompt`, `parseKeystone` (garbage→null, fence-strip,
  clamp), `shouldFireEvent` threshold. ~25 tests.
- **Structural** (readFileSync+grep, zero vi.mock): gather-facts (reads each
  tier via its store, best-effort try/catch), synthesize (sonnet + parseKeystone
  + null-on-fail), index (persistCandidates source='reflector_v2' + localWeek
  gate + significance gate), wiring (scheduler gated by isV2ReflectorEnabled +
  calls runWeekly/runEventCheck).
- **Integration** (`__integration__/v2-reflector-flow.test.ts`): keystone flows
  into the EXISTING insight-store (`persistCandidates` with source=
  'reflector_v2'); reflector-v2 reads ≥3 v2 tiers (grep getUserAxesStore /
  getBotTraitsStore / getMoodTimeline etc.); never writes B1–B4 stores.
- Baseline 1723 tests stay green; R2 adds ~50–60. No migration.

---

## 9. Rollout (explicit Berik approval per step — discipline lock)
1. All tasks local, commit-per-step, tsc + vitest green each.
2. Push (on "push"). 3. Deploy — NO migration (reuses Insight). Verify deploy
   Online. 4. Flag `FEATURE_V2_REFLECTOR=user-cmp6n0jf90000pf017gv1kukz`
   (Berik Telegram id). 5. SMOKE: trigger an event keystone (or wait for the
   weekly) → a personalised cross-tier insight arrives in Telegram referencing
   ≥2 tiers (e.g. "настроение просело + ты забросил чтение — твоя цель 50 книг
   под угрозой; 15 минут сегодня"). `/insights` (if surfaced) shows it.

---

## 10. Task Breakdown (preview — details in plan)
| # | Task | Files |
|---|---|---|
| B1 | `reflector-v2/types.ts` + pure helpers (significanceScore, summarise, parseKeystone, shouldFireEvent, EVENT_THRESHOLD) | types(+test) |
| B2 | `gather-facts.ts` cross-tier best-effort read | gather-facts(+test) |
| B3 | `synthesize.ts` sonnet keystone | synthesize(+test) |
| B4 | `detect-event.ts` shouldFireEvent | detect-event(+test) |
| B5 | `index.ts` runWeekly + runEventCheck (+ localWeek gate, persistCandidates) | index(+test) |
| C1 | `isV2ReflectorEnabled` flag + proactive-scheduler wiring | flags, scheduler(+test) |
| E1 | integration test + full verify + progress tracker | __integration__, docs |

~7 atomic tasks (no schema/migration → smaller than B4). Mirrors B1–B4 granularity.

---

## Self-review checklist (pre-approval)
- [x] Consumes v2 tiers (the gap) via their public stores, read-only.
- [x] Reuses Insight store + delivery (no new lifecycle/delivery code).
- [x] No new table / migration (zero DB-migration risk).
- [x] Two modes (weekly + event) per Berik; both best-effort, gated.
- [x] No spam — inherits R9/R10/R11/≤1-push.
- [x] Never fabricates (null synthesis → nothing).
- [x] Flag-gated, reversible, scheduler-safe.

**Awaiting Berik review → writing-plans → subagent execution.**
