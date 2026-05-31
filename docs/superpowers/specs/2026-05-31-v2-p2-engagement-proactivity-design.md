# v2 — P2 Engagement-Aware Proactivity (lean) — Design Spec

**Status:** DRAFT → awaiting Berik approval
**Author:** Claude (subagent-driven)
**Date:** 2026-05-31
**Depends on:** v2-proactivity-engine (KAIROS gates), insight-store delivery, Reflector v2, existing Insight/InsightDismissal/ChatMessage models
**Quality bar:** «Умный Джарвис» — no халтура.

---

## 1. Context & Motivation

Proactivity today has KAIROS gates (DND / rate-limit / significance threshold /
dedup) and quiet-hours-aware delivery (`chooseInsightToPush`: outside quiet
hours, top-severity, ≤1/day). Content adapts (frequently-dismissed insight
kinds get muted via `InsightDismissal`, Phase 4.4). Reflector v2 added the
cross-tier compound nudge.

**The remaining gap (P2's only real delta):** delivery is on a FIXED schedule —
"any hour outside quiet hours, once a day." The bot does NOT learn the user's
**responsiveness** (does he engage with or ignore nudges?) nor his **active
hours** (when does he actually use the bot?). So it can over-pester a
disengaged user, or fire at a bad hour.

**P2 (lean)** makes proactivity engagement-aware on two axes — HOW MUCH to
nudge (adaptive significance threshold) and WHEN (preferred active hour) — with
NO new table/model, reusing `InsightDismissal`, `Insight.deliveredAt`, and
`ChatMessage` history.

### Honest scope note
Adaptive timing is data-hungry; with one user and recent history the signal is
thin. This lean version is deliberately small (helpers + light wiring, no new
store) so it degrades gracefully to today's fixed behavior when data is sparse.

---

## 2. Scope & Decisions (locked with Berik 2026-05-31)

- ✅ **Lean engagement throttle** (Berik chose this over full adaptive-timing /
  defer).
- ✅ **Two adaptations:** (a) adaptive significance threshold from recent
  receptiveness; (b) preferred-active-hour delivery bias.
- ✅ **No new table/migration** — reuse InsightDismissal + Insight.deliveredAt +
  ChatMessage.
- ✅ **Feature flag** `isV2EngagementEnabled` (env `FEATURE_V2_ENGAGEMENT`).
  Off → today's fixed behavior, exactly.
- ✅ **Best-effort, degrade-safe** — engagement read fails / sparse data →
  receptiveness defaults to neutral (0.5) and the base threshold/all-hours are
  used (no behavior change).

### Non-Goals
- ❌ New engagement-by-hour table / ML model (full adaptive-timing — deferred).
- ❌ Changing quiet-hours / ≤1-day / dedup (those stay; P2 layers on top).
- ❌ Per-insight-kind timing models. One receptiveness score + one active-hour
  window per user.
- ❌ Blocking critical insights — severity ≥ critical always delivers regardless
  of hour/receptiveness.

---

## 3. Two adaptations

### 3.1 Adaptive significance threshold (HOW MUCH)
`receptiveness ∈ [0,1]` from a recent window (e.g. 14 days):
- nudges delivered (`Insight.deliveredAt` set) vs how many were dismissed
  (`InsightDismissal`) or ignored (delivered but no user `ChatMessage` reply
  within N hours after).
- High dismiss/ignore → low receptiveness; engaged → high.

`adaptiveThreshold(base, receptiveness)`: low receptiveness RAISES the bar
(pester less), high receptiveness lowers it (catch more moments), clamped to a
sane band around `base`. Wired into `gate3_Significance` (proactivity) and the
Reflector v2 event threshold.

### 3.2 Preferred active hour (WHEN)
From the user's `ChatMessage` local-hour histogram → an "active window" (hours
with a meaningful share of messages). `deliverTopInsight` delivers when the
current local hour is receptive; otherwise DEFERS (returns without delivering;
the next scheduler tick retries — and since `deliveredAt` stays null, the
insight survives until a receptive hour or its TTL). Critical severity bypasses
this. Layered on top of the existing quiet-hours + ≤1/day gates.

---

## 4. Components (`src/services/engagement/`)

### 4.1 `types.ts` — pure helpers (unit-tested, no I/O)
```ts
/** Receptiveness 0..1 from recent nudge outcomes. Neutral 0.5 when no data. */
export function receptivenessScore(
  delivered: number, dismissed: number, repliedWithin: number,
): number; // engaged = repliedWithin/delivered high & dismissed low

/** Adaptive significance threshold around a base. Low receptiveness → higher
 *  bar (less pestering); high → lower. Clamped to [base-0.15, base+0.25]. */
export function adaptiveThreshold(base: number, receptiveness: number): number;

/** 24-slot histogram (counts) of message local-hours. */
export function activeHourHistogram(localHours: number[]): number[];

/** Is `hour` a receptive hour — its share of total ≥ minShare? Empty/sparse
 *  histogram → true (don't block when we don't know). */
export function isReceptiveHour(hist: number[], hour: number, minShare?: number): boolean;
```

### 4.2 `engagement.ts`
`getEngagement(userId, now): Promise<{ receptiveness: number; activeHours: number[] }>`
— best-effort reads: Insight delivered/dismissed counts (last 14d), ChatMessage
local-hours (last 30d, role='user'), computes the helpers. Any failure →
`{ receptiveness: 0.5, activeHours: [] }` (neutral). Never throws.

### 4.3 `index.ts` — `getEngagementStore()` singleton + re-exports.

---

## 5. Wiring + Flag
- `src/lib/feature-flags.ts` — `isV2EngagementEnabled(userId)` (same shape as siblings; env `FEATURE_V2_ENGAGEMENT`).
- `v2-proactivity-engine.filterCandidates` — when enabled, gate3 uses
  `adaptiveThreshold(BASE_SIGNIFICANCE, eng.receptiveness)` instead of the fixed
  threshold. (Compute `eng` once per filter run.)
- `insight-store.deliverTopInsight` — when enabled, after choosing the insight,
  if `chosen.severity < CRITICAL` and `!isReceptiveHour(eng.activeHours, localHour)`
  → defer (do not deliver this tick). Else deliver as today.
- `reflector-v2.runEventCheck` — when enabled, compare significance against
  `adaptiveThreshold(EVENT_THRESHOLD, eng.receptiveness)` instead of the constant.
- All gated by `isV2EngagementEnabled`; flag off → byte-identical to today.

---

## 6. Safety / degradation
- **No new table/migration.** Reuses existing rows.
- **Degrade-safe**: engagement read failure or sparse data → neutral
  receptiveness (0.5) + empty active-hours (treated as "all hours receptive") →
  thresholds equal base, no deferral → today's behavior.
- **Critical never blocked**: severity ≥ critical always delivers.
- **Flag-gated, reversible**.
- **No infinite deferral**: a deferred insight keeps its TTL (R9) — if no
  receptive hour arrives before expiry, it simply expires (acceptable; it was
  low-severity).

---

## 7. Testing Strategy (mirror v2 modules)
- **Pure unit**: `receptivenessScore` (engaged/disengaged/no-data→0.5),
  `adaptiveThreshold` (raises on low, lowers on high, clamped), `activeHourHistogram`
  (24 slots, counts), `isReceptiveHour` (share gate, empty→true). ~22 tests.
- **Structural** (readFileSync+grep, zero vi.mock): engagement.ts (best-effort
  reads + neutral fallback), filterCandidates wiring (adaptiveThreshold +
  isV2EngagementEnabled gate), deliverTopInsight wiring (defer on non-receptive
  hour + critical bypass), reflector-v2 event-threshold wiring.
- **Integration** (`__integration__/v2-engagement-flow.test.ts`): gate3 uses
  adaptive threshold; deliverTopInsight respects receptive hour; all gated.
- Baseline 1776 tests stay green; P2 adds ~30. No migration.

---

## 8. Rollout (explicit Berik approval per step)
1. Tasks local, commit-per-step, tsc + vitest green each.
2. Push (on "push"). 3. Deploy — NO migration. Verify Online.
4. Flag `FEATURE_V2_ENGAGEMENT=user-cmp6n0jf90000pf017gv1kukz`.
5. SMOKE (subtle — timing): hard to force live; verify via logs that gate3
   threshold + delivery-hour decision reflect engagement. Acceptable to verify
   structurally + watch over a few days (data-thin caveat).

---

## 9. Task Breakdown (preview)
| # | Task | Files |
|---|---|---|
| B1 | `engagement/types.ts` + 4 pure helpers | types(+test) |
| B2 | `engagement.ts` getEngagement best-effort | engagement(+test) |
| B3 | `engagement/index.ts` singleton | index(+test) |
| C1 | `isV2EngagementEnabled` + filterCandidates adaptive gate3 | flags, engine(+test) |
| C2 | deliverTopInsight receptive-hour defer + reflector event threshold | insight-store, reflector-v2(+test) |
| E1 | integration + full verify + progress tracker | __integration__, docs |

~6 atomic tasks. No schema/migration.

---

## Self-review checklist (pre-approval)
- [x] Only real delta (learned timing/engagement); no R2/quiet-hours overlap.
- [x] Two adaptations: threshold (how much) + hour (when).
- [x] No new table/migration; reuses InsightDismissal/deliveredAt/ChatMessage.
- [x] Degrade-safe (neutral defaults → today's behavior); critical never blocked.
- [x] Flag-gated, reversible. Pure + structural + integration tests, zero vi.mock.
- [x] Honest data-thin caveat documented.

**Awaiting Berik review → writing-plans → subagent execution.**
