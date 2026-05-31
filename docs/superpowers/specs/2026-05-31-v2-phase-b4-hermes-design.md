# v2 Phase B4 — Hermes (Composable Skills) — Design Spec

**Status:** DRAFT → awaiting Berik approval
**Author:** Claude (subagent-driven)
**Date:** 2026-05-31
**Depends on:** existing tool registry (`src/tools/`), proactivity-engine, procedural-memory, Voyage embeddings (paid)
**Quality bar:** «Умный Джарвис» — no халтура.

---

## 1. Context & Motivation

LifeOS already has ~30 hand-written tools (`src/tools/`), each a self-describing
object `{ name, description, category, zod schema, needsConfirm, sideEffects, handler }`.
Adding a capability today requires a developer to write a file, import it, recompile.

**Hermes lets the bot grow its own capabilities — safely.** A *skill* is a
saved, named, reusable **composition of existing tools** plus a synthesis
instruction. The bot can assemble skills (proactively, when it notices a
repeated pattern; or explicitly, when the user asks) and run them by name or
trigger phrase.

This is the north-star "one brain that grows its own hands": the bot doesn't
wait for a developer to wire each new routine — it composes what it already has.

### What Hermes is NOT (hard safety boundary)
A skill is **data, not code**. There is **no codegen, no eval, no
arbitrary-code execution**. A skill cannot do anything a tool can't already
do. It is a saved plan over the *existing* whitelisted tool registry.

---

## 2. Scope & Decisions (locked with Berik 2026-05-31)

- ✅ **Composed skills** (not declarative micro-tools, not sandboxed codegen) —
  Berik chose this. Skill = recipe of existing tools + synthesis.
- ✅ **Both creation paths**: proactive (bot detects a repeated pattern and
  proposes) **and** explicit (user says "сделай из этого навык"). Berik chose both.
- ✅ **Full tool surface MINUS pet + photo/calorie.** Berik: «использоваться
  должны все функции в приложении, кроме питомца и фото (калорийность)». A
  skill may compose ANY current tool (finance, task, habit, calendar, travel,
  memory, info), including **money/write** tools. Safety is preserved because
  **each step inherits its tool's own gate** (§4). The blocklist
  (`pet`, `photo_calorie`) is enforced at skill-creation and at run-seed time.
- ✅ **Per-user**, feature-flagged `isV2HermesEnabled` (env `FEATURE_V2_HERMES`).
- ✅ **Reversible**: drop table + unset flag.

### Non-Goals (v1)
- ❌ Codegen / sandboxed JS / new tool *code*.
- ❌ Skills calling other skills (no recursion) — v1.
- ❌ Skills that touch pet (тамагочи) or photo-calorie capabilities.
- ❌ A new confirm/permission engine — we **reuse** the existing one (§4).
- ❌ Background/scheduled auto-running of skills without the user — v1 only
  runs a skill when the user triggers it (proactive engine only *proposes
  creation*, never silently *runs* a money skill).

---

## 3. Core Architecture — "skill = seeded instruction, executed by the existing agent loop"

The key design choice (and what makes money inclusion safe + low-code):

> **A skill does NOT execute tool handlers through a new bespoke interpreter.**
> Running a skill = the orchestrator seeds the **existing agent turn** with the
> skill's plan + synthesis instruction. The normal agent loop then calls the
> tools — so every tool's existing gate applies automatically: `read` steps run
> freely, `write`/`external`/money steps hit their existing `needsConfirm`
> confirmation (PendingAction) exactly as in a normal conversation.

```
user says trigger ("утренний брифинг")  OR  /skills run "Утренний брифинг"
                    │
          skill-router: match message vs active skills' triggers
          (Voyage cosine ≥ threshold OR exact /skills run)
                    │  match → SkillDefinition
                    ▼
   buildSkillInstruction(def) → a seeded system instruction:
     "Выполни навык «Утренний брифинг». План: get-tasks → get-calendar →
      get-budget. Затем: <synthesis>. Соблюдай обычные правила подтверждения."
                    │
                    ▼
        EXISTING jarvis agent loop runs the turn
        (tool dispatch + per-tool needsConfirm + tool-audit — all reused)
                    │
                    ▼
        read steps auto-run · money/write steps → existing confirm gate
                    │
                    ▼
              composed answer to the user + bumpUsage(skill)
```

**Why this model:**
- **Safety for free** — money/write steps inherit the same confirm gate the
  agent already enforces. No new permission code = no new way to bypass it.
- **Low code** — no resumable state machine, no nested agent invocation, no
  re-implementation of tool dispatch/confirm/audit.
- **Robust** — if a tool is unavailable (integration off), the agent adapts,
  same as normal conversation.
- Determinism comes from the explicit plan in the seeded instruction; the
  agent follows it but degrades gracefully.

---

## 4. Safety Model (defense in depth)

1. **Blocklist at creation** — `validateSkillTools(plan, registry, BLOCKLIST)`
   rejects a skill whose plan references a non-existent tool, or a blocklisted
   capability (`pet`, `photo_calorie`). Thrown at create time → skill never saved.
2. **Blocklist at run-seed** — re-validate when building the instruction
   (defense in depth; registry/blocklist may have changed since creation).
3. **Inherited per-tool gates** — because execution goes through the existing
   agent loop, money/write/external steps trigger their existing `needsConfirm`
   confirmation. A skill cannot silently spend money or send a message.
4. **No recursion** — a skill's plan may not reference another skill (v1).
   Enforced in `validateSkillTools` (skill-virtual-tool names rejected).
5. **Step cap** — ≤ 8 steps per skill (`validateSkillTools`).
6. **Per-user isolation** — `SkillDefinition.userId`; router only matches the
   acting user's skills.
7. **Audit** — skill runs flow through the existing `tool-audit` (each
   underlying tool call is already audited). Plus `SkillDefinition.useCount` /
   `lastUsedAt` for transparency.
8. **Feature flag** — `isV2HermesEnabled(userId)`; off = router/creation inert.

`BLOCKLIST` (v1): tool `category === 'pet'` *(none exist yet)*, and any future
`photo_calorie` tool. Implemented as a small explicit set checked by name +
category, so it's robust when those tools land.

---

## 5. Data Model

```prisma
model SkillDefinition {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  name        String    // "Утренний брифинг"
  description String    // when to use it (for router + /skills list)
  triggers    String[]  // phrase examples: ["брифинг", "как дела с утра"]
  plan        Json      // [{ toolName, argTemplate? }] ordered; existing tools only
  synthesis   String    // how to combine step results into one answer
  source      String    // 'proactive' | 'explicit'
  active      Boolean   @default(true)
  useCount    Int       @default(0)
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@unique([userId, name])
  @@index([userId, active])
}
```
- `plan` JSON shape: `Array<{ toolName: string; argTemplate?: Record<string, unknown> }>`.
  `argTemplate` holds static args or `{{placeholders}}` resolved from the user's
  message at run time (v1: static + a few well-known placeholders like
  `{{today}}`; full templating is a follow-up).
- Standard Prisma migration folder `20260531210000_v2_hermes_skills/migration.sql`
  (idempotent, mirrors B1/B2/B3 style — **lesson from B3: never a `manual/` dir**).
- `User.skills SkillDefinition[]` reverse relation.

---

## 6. Components (`src/services/hermes/`)

### 6.1 `types.ts` — types + pure helpers (unit-tested, no I/O)
- `SkillStep = { toolName: string; argTemplate?: Record<string, unknown> }`
- `SkillSpec = { name, description, triggers: string[], plan: SkillStep[], synthesis: string }`
- `BLOCKLIST: { categories: Set<string>; toolNames: Set<string> }` (pet, photo_calorie)
- `validateSkillTools(plan, knownToolNames, knownCategoryByTool, blocklist)` →
  throws `SkillValidationError` on: unknown tool, blocklisted category/name,
  skill-referencing-skill, > 8 steps, empty plan.
- `parseSkillSpec(raw: string): SkillSpec | null` — defensive JSON parser
  (fence-strip, shape-validate), never throws; returns null on garbage.
- `MAX_STEPS = 8`.

### 6.2 `skill-builder.ts` — Claude haiku draft generators (best-effort)
- `buildSkillFromRequest(userId, userText, registrySummary): Promise<SkillSpec | null>`
  — explicit path ("сделай навык, который утром даёт задачи и бюджет").
- `proposeSkillFromPattern(userId, toolCluster, registrySummary): Promise<SkillSpec | null>`
  — proactive path: given a recurring co-occurring tool cluster (from
  procedural-memory), draft a named skill. Both call haiku with a system prompt
  listing available tools; both run `parseSkillSpec`. Never throw → null.

### 6.3 `skill-runner.ts` — instruction builder (NO direct tool exec)
- `buildSkillInstruction(def: SkillDefinition): string` — pure function that
  renders the seeded instruction (plan + synthesis + "обычные правила
  подтверждения"). Re-runs `validateSkillTools` (defense in depth) — if invalid,
  returns null and the run is skipped.
- `bumpUsage(store, id)` helper (usage stats). No tool dispatch here — the
  orchestrator owns execution.

### 6.4 `skill-router.ts` — match user message → skill
- `routeToSkill(userId, text, activeSkills): Promise<SkillDefinition | null>`
  — exact-name match (for `/skills run`) OR Voyage cosine of `text` vs each
  skill's `triggers`/`description` ≥ `ROUTE_THRESHOLD` (≈0.8). Gated by
  `embeddingsEnabled()`; best-effort → null.

### 6.5 `postgres-impl.ts` — `HermesStore`
- `createSkill(userId, spec)` — runs `validateSkillTools` then persist (unique
  on name; on clash → suffix or reject, see §8).
- `listSkills(userId)`, `getSkill`, `deleteSkill`, `bumpUsage`. Best-effort reads.

### 6.6 `index.ts` — `getHermesStore()` singleton + re-exports.

---

## 7. Integration points (wiring)

1. **Create — explicit:** new tool `create_skill` (`needsConfirm: true`,
   `category: 'system'`, `sideEffects: 'write'`). Handler calls
   `buildSkillFromRequest` → `createSkill`. The agent calls it when the user
   says "сделай навык …". Confirm gate shows the drafted skill before saving.
2. **Create — proactive:** new proactivity detector `detectSkillOpportunity`
   (in v2-proactivity-engine): reads procedural-memory recurring tool-clusters;
   if a cluster of ≥3 co-used tools recurs ≥N times and no skill covers it →
   emit a `skill_suggestion` nudge through the existing KAIROS gates. User
   confirms → `create_skill` path.
3. **Run:** in `jarvis-orchestrator`, **before** the agent loop, if
   `isV2HermesEnabled(userId)`: `routeToSkill(...)`; on match, seed the turn's
   instruction with `buildSkillInstruction(def)` and `bumpUsage`. The existing
   loop executes (with existing gates). Best-effort: router failure → normal turn.
4. **Manage:** `/skills` Telegram command — list (name + useCount + last used),
   `/skills show <name>`, `/skills run <name>`, `/skills delete <name>`.

---

## 8. Edge cases & decisions
- **Name clash** (`@@unique[userId,name]`): `createSkill` appends ` (2)` etc.
  rather than throwing — bot stays friendly.
- **Empty / 1-step plan**: a 1-step "skill" is allowed (a saved shortcut) but
  proactive proposal requires ≥3 steps (not worth proposing a rename of one tool).
- **Tool removed after skill saved**: run-seed re-validation drops the skill
  gracefully and tells the user "навык устарел — пересоздать?".
- **Trigger collides with normal chat**: `ROUTE_THRESHOLD` high (≈0.8) +
  exact-name path; a near-miss just runs a normal turn (no harm).
- **Money inside a skill**: never auto-executes — the seeded instruction routes
  through the agent's existing money confirm gate. The skill makes the *plan*
  convenient; the *authorization* stays per-step.

---

## 9. Testing Strategy (mirror B1/B2/B3)
- **Pure unit** (no I/O): `validateSkillTools` (all reject paths + happy),
  `parseSkillSpec` (garbage → null, fence-strip, shape), `buildSkillInstruction`
  (renders plan + synthesis; null on invalid). ~25 tests.
- **Structural** (readFileSync+grep, dynamic-import for scripts, zero vi.mock):
  builder (haiku best-effort + parse), router (Voyage gate + cosine + threshold),
  postgres (validate-on-create + CRUD), create_skill tool (needsConfirm:true +
  blocklist), orchestrator wiring (gated + routeToSkill + buildSkillInstruction),
  detector (skill_suggestion + KAIROS), /skills command.
- **Integration** (`__integration__/v2-hermes-flow.test.ts`): skill runs via the
  existing agent loop (not a bespoke executor); blocklist enforced; money step
  still hits confirm (assert no direct add-expense handler call in skill-runner).
- Baseline 1670 tests stay green; B4 adds ~55–65.

---

## 10. Rollout (explicit Berik approval per step — discipline lock)
1. All tasks local, commit-per-step, tsc + vitest green each.
2. Push (on "push"). 3. Deploy — Railway migrate-deploy auto-applies
   `20260531210000_v2_hermes_skills`. Verify table in prod.
4. Flag `FEATURE_V2_HERMES=user-cmp6n0jf90000pf017gv1kukz` (Berik Telegram id;
   DUAL ACCOUNT — not email id). 5. SMOKE: say "сделай навык: утром давай
   задачи и бюджет" → confirm → say "утренний брифинг" → skill runs; `/skills`
   lists it.

---

## 11. Task Breakdown (preview — details in plan)
| # | Task | Files |
|---|---|---|
| A1 | `SkillDefinition` model + reverse rel + standard migration folder | schema, migration |
| B1 | `hermes/types.ts` + pure helpers (validateSkillTools, parseSkillSpec, BLOCKLIST) | types(+test) |
| B2 | `skill-builder.ts` (explicit + proactive haiku drafts) | builder(+test) |
| B3 | `skill-runner.ts` (buildSkillInstruction + bumpUsage) | runner(+test) |
| B4 | `skill-router.ts` (exact + Voyage cosine) | router(+test) |
| B5 | `postgres-impl.ts` (createSkill validate-gate + CRUD) | postgres(+test) |
| B6 | `hermes/index.ts` singleton + re-exports | index(+test) |
| C1 | `create_skill` tool (needsConfirm, blocklist) + register | tools(+test) |
| C2 | flag `isV2HermesEnabled` + orchestrator run-seed wiring | flags, orchestrator |
| D1 | `detectSkillOpportunity` proactivity detector | engine(+test) |
| D2 | `/skills` Telegram command (list/show/run/delete) | telegram(+test) |
| E1 | integration test + full verify + progress tracker | __integration__, docs |

~12 atomic tasks. Mirrors B1/B2/B3 granularity.

---

## Self-review checklist (pre-approval)
- [x] Skill = data, no codegen/eval (hard boundary §1).
- [x] Money/write INCLUDED (Berik) but safe via inherited confirm gates (§3/§4).
- [x] Pet + photo/calorie blocklisted at create AND run (§4).
- [x] No new permission engine — reuse existing agent loop + gates (§3).
- [x] Both creation paths (proactive detector + explicit tool) (§7).
- [x] Standard migration folder, not `manual/` (B3 lesson) (§5).
- [x] Feature-flagged, per-user, reversible (§2/§10).
- [x] Structural + pure tests, zero vi.mock (§9).

**Awaiting Berik review → writing-plans → subagent execution.**
