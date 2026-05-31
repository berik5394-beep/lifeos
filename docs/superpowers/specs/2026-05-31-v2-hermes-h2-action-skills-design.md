# v2 — Hermes H2 (Action Skills) — Design Spec

**Status:** DRAFT → awaiting Berik approval
**Author:** Claude (subagent-driven)
**Date:** 2026-05-31
**Depends on:** B4 Hermes (skills, in prod), existing tool registry + PendingAction confirm flow
**Quality bar:** «Умный Джарвис» — no халтура.

---

## 1. Context & Motivation

B4 shipped composable skills. A skill's plan can already reference ANY tool
(validateSkillTools blocks only pet/photo), and read + write-non-money steps
EXECUTE today via the agent-loop seed (e.g. "утренний брифинг" works in prod).

**The gap:** money/confirm steps (`add-expense`, `add-income`, `send-telegram`,
`suggest-goal` — all `needsConfirm:true`) do NOT execute. The agent loop only
sees `needsConfirm:false` tools (`agentToolSchemasForUser` filter — the security
invariant that keeps the autonomous loop off money). So a skill seeded into the
agent loop names a money tool the agent can't call → that step silently fails
(same class as the create_skill bug). Yet validateSkillTools ALLOWS creating
such a skill → a latent footgun.

**H2** makes action skills with money/confirm steps actually execute —
deterministically, with one explicit batched confirmation — delivering the
headline "вечерний разбор → запиши расход 3000 + закрой привычки + создай
задачи" example.

---

## 2. Scope & Decisions (locked with Berik 2026-05-31)

- ✅ **Full action skills incl. money** (Berik chose this over non-money-only).
- ✅ **Route by skill composition (§3.1)** — read/write-non-money skills keep
  the existing agent-loop seed (ZERO regression to working skills like
  "утренний брифинг"); skills containing ≥1 `needsConfirm:true` step go through
  a new deterministic SkillRunner.
- ✅ **Two-phase execution** — auto steps (`needsConfirm:false`) run immediately
  via `runRegistryTool`; money/confirm steps are batched into ONE PendingAction
  confirmed by a single «да».
- ✅ **arg-templating** — a haiku resolver fills each step's args from the user's
  message at run time ("запиши расход 3000" → `add-expense{amount:3000}`).
- ✅ **No new flag** — H2 upgrades Hermes under the existing `isV2HermesEnabled`.
- ✅ **No new Prisma table / migration** (reuses SkillDefinition + PendingAction
  + Insight/audit). Zero migration risk.

### Non-Goals
- ❌ Resumable mid-flight pause/resume state machine (the two-phase "auto then
  batch-confirm" model avoids it).
- ❌ Changing the `needsConfirm`/agent-loop security invariant (money still
  always confirms — now via the batched PendingAction, stricter not looser).
- ❌ Skill embedding cache — separate filed follow-up (perf, not function).
- ❌ Multi-turn arg collection ("how much?") — v1 resolves from the single
  message; missing required args → the step is dropped with a note.

---

## 3. Core Architecture

### 3.1 Routing by composition (no regression)
In the orchestrator's existing Hermes run-seed block (B4 C2), after
`routeToSkill` matches a skill:
```
matched skill
   │
has any step where tool.needsConfirm is truthy?  (via toolConfirmRequired)
   │ no                                  │ yes
   ▼                                     ▼
EXISTING agent-loop seed          NEW deterministic runSkillPlan(...)
(unchanged — read/write skills)   (action skills incl. money)
```
Read-only & write-non-money skills are byte-for-byte unaffected.

### 3.2 Deterministic two-phase runner
`runSkillPlan(userId, skill, userMessage)`:
1. **arg-resolve** — `resolveSkillArgs(plan, userMessage)` (haiku) → per-step
   args object. Best-effort: on failure, use the step's stored `argTemplate`
   (or `{}`).
2. **partition** — split plan steps into `auto` (`needsConfirm` falsy) and
   `confirm` (`needsConfirm` truthy), preserving order, via `toolConfirmRequired`.
3. **Phase auto** — for each auto step, `runRegistryTool(step.toolName, args, {userId})`;
   collect `{toolName, output}`. A step that throws is recorded as failed and
   skipped (best-effort).
4. **synthesize** — haiku: `skill.synthesis` + collected auto outputs → final
   user-facing text (same "nice message" read-skills get today).
5. **Phase confirm** — if `confirm` steps exist: set ONE PendingAction
   `{action:'run_skill_actions', input:{steps:[{toolName,args}], skillName}}`
   and append a confirm prompt listing the actions ("Подтвердить: записать
   расход 3000? [да/нет]"). Else: no pending.
6. return the message (+ pending set as a side effect).

### 3.3 Confirm execution
On the user's «да», the existing confirm path (`readConfirmSignal` →
`takePendingAction` → `runConfirmedAction`) fires. `runConfirmedAction` gets a
new branch: `action === 'run_skill_actions'` → loop `input.steps`, each via
`runRegistryTool(s.toolName, s.args, {userId})`, concatenate the results into
one reply ("Записал расход 3000. Записал доход…"). Money executes ONLY here,
after «да».

---

## 4. Components

`src/services/hermes/`:
- **arg-resolver.ts** — `resolveSkillArgs(plan: SkillStep[], userMessage: string): Promise<Record<string, unknown>[]>`
  (haiku, best-effort, returns one args object per step; on fail → stored
  argTemplate or `{}`). + pure `parseArgsResponse(raw, planLen)` (defensive,
  never throws, returns array sized to plan).
- **skill-runner.ts** — `runSkillPlan(userId, skill, userMessage): Promise<string>`
  (the two-phase orchestrator above). + pure
  `partitionSteps(plan, needsConfirmOf): {auto: Step[], confirm: Step[]}`
  where `needsConfirmOf(toolName, args) => boolean`.
- **hermes/index.ts** — re-export `runSkillPlan`, `resolveSkillArgs`.

`src/services/`:
- **jarvis-orchestrator.ts** — (a) in the Hermes run-seed block: branch on
  "any confirm step?" → `runSkillPlan` vs existing seed; (b) `runConfirmedAction`:
  add the `run_skill_actions` branch.

Reused (no change): `runRegistryTool`, `toolConfirmRequired`, `setPendingAction`,
`takePendingAction`, `readConfirmSignal`, `registry`.

---

## 5. Safety
- **Money never auto-runs**: money/external/confirm steps execute ONLY after an
  explicit «да» (batched PendingAction). Stricter than today (one «да» = whole
  batch, with an explicit list shown first).
- **validateSkillTools unchanged**: money tools stay allowed at creation — now
  safe because they route through confirm at run time.
- **Blocklist** pet/photo unchanged (create + run).
- **Deterministic & auditable**: every executed step is a `runRegistryTool` call
  → existing ToolCall audit + zod validation.
- **Best-effort**: arg-resolve / synthesize failures degrade gracefully; auto
  steps already done; confirm steps preserved in the PendingAction.
- **No regression**: read/write-non-money skills keep the exact existing path.
- Under existing `isV2HermesEnabled`. Reversible (no schema; revert commits).

---

## 6. Data model
**No new table.** Reuses `SkillDefinition` (plan), `PendingAction` (the batched
`run_skill_actions` payload — a JSON `{steps, skillName}` in its existing
`input` field), `ToolCall` audit. No migration.

---

## 7. Testing Strategy (mirror B1–B4)
- **Pure unit** (no I/O): `partitionSteps` (auto/confirm split by needsConfirm,
  order preserved, all-auto / all-confirm / mixed), `parseArgsResponse`
  (garbage → safe array sized to plan, fence-strip). ~18 tests.
- **Structural** (readFileSync+grep, zero vi.mock): arg-resolver (haiku +
  parse + best-effort fallback), skill-runner (two phases + runRegistryTool +
  synthesize + setPendingAction), orchestrator branch (composition routing +
  runSkillPlan), runConfirmedAction `run_skill_actions` branch (loops
  runRegistryTool).
- **Integration** (`__integration__/v2-hermes-action-flow.test.ts`): an action
  skill with a money step → auto steps run, money batched into PendingAction;
  read-only skill path UNCHANGED (still seeds the agent loop); money executes
  only via the confirm branch.
- Baseline 1752 tests stay green; H2 adds ~45–55. No migration.

---

## 8. Rollout (explicit Berik approval per step)
1. All tasks local, commit-per-step, tsc + vitest green each.
2. Push (on "push"). 3. Deploy — NO migration. Verify Online.
4. (Flag already ON for Berik — `FEATURE_V2_HERMES`.) 5. SMOKE: create
   "вечерний разбор" skill (get-today + add-expense + complete habits) → run it
   → read steps execute + "Подтвердить: записать расход N? [да/нет]" → «да» →
   money recorded. AND re-run "утренний брифинг" → still works (no regression).

---

## 9. Task Breakdown (preview)
| # | Task | Files |
|---|---|---|
| B1 | `arg-resolver.ts` (resolveSkillArgs haiku + parseArgsResponse pure) | arg-resolver(+test) |
| B2 | `skill-runner.ts` — partitionSteps (pure) | skill-runner(+test) |
| B3 | `skill-runner.ts` — runSkillPlan two-phase + synthesize + pending | skill-runner(+test) |
| B4 | hermes/index re-exports | index(+test) |
| C1 | orchestrator: composition routing → runSkillPlan vs seed | orchestrator(+test) |
| C2 | orchestrator: runConfirmedAction `run_skill_actions` branch | orchestrator(+test) |
| E1 | integration test + full verify + progress tracker | __integration__, docs |

~7 atomic tasks. No schema/migration.

---

## Self-review checklist (pre-approval)
- [x] Money/confirm steps execute ONLY via explicit «да» (batched).
- [x] Zero regression: read/write skills keep existing agent-loop path (routed by composition).
- [x] arg-templating fills dynamic args from the message.
- [x] Reuses confirm/PendingAction/runRegistryTool machinery (no new permission code).
- [x] No new table/migration; under existing flag; reversible.
- [x] Pure + structural + integration tests, zero vi.mock.

**Awaiting Berik review → writing-plans → subagent execution.**
