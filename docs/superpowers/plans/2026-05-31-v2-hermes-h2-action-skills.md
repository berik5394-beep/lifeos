# v2 — Hermes H2 (Action Skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skills with money/confirm steps actually execute — a deterministic two-phase runner runs the auto steps and batches money steps into one explicit confirmation.

**Architecture:** Route by skill composition: a matched skill with any `needsConfirm` step goes through a new deterministic `runSkillPlan` (auto steps via `runRegistryTool` + a synthesized message + money steps batched into one `run_skill_actions` PendingAction confirmed by «да»); skills without confirm steps keep the existing agent-loop seed (zero regression). A haiku arg-resolver fills step args from the user's message.

**Tech Stack:** TypeScript strict, Anthropic haiku, vitest (pure unit + structural readFileSync+grep, zero vi.mock). Reuses existing confirm/PendingAction/runRegistryTool/audit machinery. NO new flag/table/migration.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-hermes-h2-action-skills-design.md` (approved by Berik 2026-05-31).

---

## CRITICAL repo facts (read before any task)
- Work on branch **`main`** in **`/Users/berikkurmangoliev/Desktop/LifeOS`** (NOT the worktree). Start EVERY bash command with `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && ...`.
- **NO schema change / migration. NO new feature flag** (reuse `isV2HermesEnabled`). `.env` `DATABASE_URL` is PROD — never run prisma migrate/db push.
- Commit per step, LOCAL only (never `git push`), heredoc message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Commands: `npx tsc --noEmit`, `npx vitest run <path>`, `npx vitest run`.
- **Verified signatures (implementer should still open the file to confirm):**
  - `SkillStep` (in `src/services/hermes/types.ts`): `{ toolName: string; argTemplate?: Record<string, unknown> }`.
  - `runRegistryTool(name: string, rawInput: unknown, ctx: { userId: string }, sink?): Promise<unknown>` — `src/tools/index.ts`. Action tools return `{ message?: string }`.
  - `toolConfirmRequired(name: string, input: unknown): boolean` — `src/tools/index.ts` (resolves `needsConfirm` boolean|function). Already imported in `jarvis-orchestrator.ts`.
  - `setPendingAction(userId, action, input, confirmationText, store?): Promise<void>` — `src/services/pending-actions.ts`. `PendingAction = { action: string; input: Record<string,unknown>; confirmationText: string; createdAt: number }`.
  - `runConfirmedAction(userId, action, input)` — `src/services/jarvis-orchestrator.ts` (~L306); calls `runRegistryTool(action, input, {userId})`.
  - The B4 Hermes run-seed block in `jarvis-orchestrator.ts` (matched-skill branch that builds `spec` + `buildSkillInstruction(spec)` + sets `hermesForceTools`, just before `let reply: string;`).
  - `MODELS.haiku` — `src/lib/models.js`.
  - Existing exports in `src/services/hermes/index.js`: `getHermesStore`, `routeToSkill`, `buildSkillInstruction`.

## File Structure
| File | Responsibility |
|---|---|
| `src/services/hermes/arg-resolver.ts` | resolveSkillArgs (haiku) + parseArgsResponse (pure) |
| `src/services/hermes/skill-runner.ts` | partitionSteps (pure) + runSkillPlan (two-phase) |
| `src/services/hermes/index.ts` | re-export runSkillPlan, resolveSkillArgs |
| `src/services/jarvis-orchestrator.ts` | composition routing → runSkillPlan vs seed; runConfirmedAction `run_skill_actions` branch |
| `src/__integration__/v2-hermes-action-flow.test.ts` | structural integration |

---

## Task B1: arg-resolver.ts

**Files:**
- Create: `packages/server/src/services/hermes/arg-resolver.ts`
- Test: `packages/server/src/services/hermes/arg-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/arg-resolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgsResponse } from './arg-resolver.js';

describe('parseArgsResponse (pure)', () => {
  it('parses an array of arg objects sized to plan', () => {
    const out = parseArgsResponse('[{"amount":3000},{}]', 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ amount: 3000 });
    expect(out[1]).toEqual({});
  });
  it('strips markdown fences', () => {
    const out = parseArgsResponse('```json\n[{"x":1}]\n```', 1);
    expect(out[0]).toEqual({ x: 1 });
  });
  it('pads/truncates to planLen', () => {
    expect(parseArgsResponse('[{"a":1}]', 3)).toHaveLength(3);
    expect(parseArgsResponse('[{},{},{},{}]', 2)).toHaveLength(2);
  });
  it('garbage → array of empty objects sized to plan', () => {
    const out = parseArgsResponse('not json', 2);
    expect(out).toEqual([{}, {}]);
    expect(parseArgsResponse('', 1)).toEqual([{}]);
  });
  it('non-object array elements → empty object', () => {
    expect(parseArgsResponse('[1,"x"]', 2)).toEqual([{}, {}]);
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/arg-resolver.ts'), 'utf-8');

describe('resolveSkillArgs structure', () => {
  it('exports resolveSkillArgs using haiku + parseArgsResponse', () => {
    expect(SRC).toMatch(/export async function resolveSkillArgs/);
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/parseArgsResponse/);
  });
  it('best-effort fallback to argTemplate / {} on failure', () => {
    expect(SRC).toMatch(/argTemplate/);
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/arg-resolver.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement arg-resolver.ts**

Create `packages/server/src/services/hermes/arg-resolver.ts`:
```ts
/**
 * v2 Hermes H2 — resolve each skill step's args from the user's message.
 * Best-effort: on any failure, falls back to the step's stored argTemplate
 * (or {}). Pure parseArgsResponse is unit-tested without Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import type { SkillStep } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/** Defensive parse: always returns exactly `planLen` plain objects. */
export function parseArgsResponse(raw: string, planLen: number): Record<string, unknown>[] {
  const empties = (): Record<string, unknown>[] =>
    Array.from({ length: planLen }, () => ({}));
  if (!raw || !raw.trim()) return empties();
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empties();
  }
  if (!Array.isArray(parsed)) return empties();
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < planLen; i++) {
    const el = parsed[i];
    out.push(el && typeof el === 'object' && !Array.isArray(el)
      ? (el as Record<string, unknown>) : {});
  }
  return out;
}

/**
 * Ask haiku to fill each step's args from the user's message. Returns one
 * args object per plan step. Best-effort: failure → per-step argTemplate ?? {}.
 */
export async function resolveSkillArgs(
  plan: SkillStep[],
  userMessage: string,
): Promise<Record<string, unknown>[]> {
  const fallback = (): Record<string, unknown>[] =>
    plan.map((s) => (s.argTemplate ? { ...s.argTemplate } : {}));
  if (plan.length === 0) return [];
  try {
    const steps = plan.map((s, i) => `${i + 1}. ${s.toolName}`).join('\n');
    const sys = `Ты заполняешь аргументы шагов навыка из сообщения пользователя.
Дан список шагов (инструменты по порядку) и сообщение. Верни ТОЛЬКО JSON-массив
объектов — по одному на КАЖДЫЙ шаг в том же порядке. В объекте — аргументы,
которые можно извлечь из сообщения для этого инструмента (например сумма,
описание, источник). Если для шага нечего извлечь — пустой объект {}.
Без markdown, без пояснений. Длина массива РОВНО ${plan.length}.`;
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content: `Шаги:\n${steps}\n\nСообщение: ${userMessage}` }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return fallback();
    const parsed = parseArgsResponse(block.text, plan.length);
    // Merge: parsed args win, but keep stored argTemplate defaults.
    return plan.map((s, i) => ({ ...(s.argTemplate ?? {}), ...parsed[i] }));
  } catch (err) {
    console.warn('[hermes:arg-resolver] failed:',
      err instanceof Error ? err.message : err);
    return fallback();
  }
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/arg-resolver.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/arg-resolver.ts src/services/hermes/arg-resolver.test.ts
git commit -F - <<'EOF'
feat(v2-h2): skill arg-resolver (B1)

resolveSkillArgs (haiku fills each step's args from the user's message) +
parseArgsResponse (pure, defensive, always sized to plan). Best-effort:
failure → stored argTemplate / {}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B2: skill-runner.ts — partitionSteps (pure)

**Files:**
- Create: `packages/server/src/services/hermes/skill-runner.ts`
- Test: `packages/server/src/services/hermes/skill-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/skill-runner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { partitionSteps } from './skill-runner.js';

const needsConfirmOf = (toolName: string): boolean =>
  toolName === 'add-expense' || toolName === 'add-income';

describe('partitionSteps (pure)', () => {
  it('splits auto vs confirm preserving order', () => {
    const plan = [
      { toolName: 'get-tasks' },
      { toolName: 'add-expense' },
      { toolName: 'complete-habit' },
      { toolName: 'add-income' },
    ];
    const args = [{}, { amount: 3000 }, {}, { amount: 500 }];
    const { auto, confirm } = partitionSteps(plan, args, needsConfirmOf);
    expect(auto.map((s) => s.toolName)).toEqual(['get-tasks', 'complete-habit']);
    expect(confirm.map((s) => s.toolName)).toEqual(['add-expense', 'add-income']);
    expect(confirm[0].args).toEqual({ amount: 3000 });
  });
  it('all-auto → empty confirm', () => {
    const plan = [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }];
    const { auto, confirm } = partitionSteps(plan, [{}, {}], needsConfirmOf);
    expect(auto).toHaveLength(2);
    expect(confirm).toHaveLength(0);
  });
  it('all-confirm → empty auto', () => {
    const plan = [{ toolName: 'add-expense' }];
    const { auto, confirm } = partitionSteps(plan, [{ amount: 1 }], needsConfirmOf);
    expect(auto).toHaveLength(0);
    expect(confirm).toHaveLength(1);
  });
  it('pairs each step with its args by index (missing → {})', () => {
    const plan = [{ toolName: 'add-expense' }];
    const { confirm } = partitionSteps(plan, [], needsConfirmOf);
    expect(confirm[0].args).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-runner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement partitionSteps in skill-runner.ts**

Create `packages/server/src/services/hermes/skill-runner.ts` (runSkillPlan added in B3):
```ts
/**
 * v2 Hermes H2 — deterministic action-skill runner.
 * partitionSteps is pure (unit-tested). runSkillPlan (B3) is the two-phase
 * orchestrator. NOTE: the seed-into-agent-loop path (B4) handles skills with
 * NO confirm steps; this runner is for skills containing money/confirm steps.
 */

import type { SkillStep } from './types.js';

export interface RunnerStep {
  toolName: string;
  args: Record<string, unknown>;
}

/** Split steps into `auto` (needsConfirm false) and `confirm` (needsConfirm
 *  true), preserving order, pairing each step with its resolved args by index. */
export function partitionSteps(
  plan: SkillStep[],
  args: Record<string, unknown>[],
  needsConfirmOf: (toolName: string, args: Record<string, unknown>) => boolean,
): { auto: RunnerStep[]; confirm: RunnerStep[] } {
  const auto: RunnerStep[] = [];
  const confirm: RunnerStep[] = [];
  plan.forEach((step, i) => {
    const a = args[i] && typeof args[i] === 'object' ? args[i] : {};
    const rs: RunnerStep = { toolName: step.toolName, args: a };
    if (needsConfirmOf(step.toolName, a)) confirm.push(rs);
    else auto.push(rs);
  });
  return { auto, confirm };
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-runner.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/skill-runner.ts src/services/hermes/skill-runner.test.ts
git commit -F - <<'EOF'
feat(v2-h2): skill-runner partitionSteps (B2)

Pure partitionSteps: splits plan into auto (needsConfirm false) vs confirm
(money), order-preserving, pairing each step with its resolved args.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B3: skill-runner.ts — runSkillPlan (two-phase)

**Files:**
- Modify: `packages/server/src/services/hermes/skill-runner.ts`
- Test: `packages/server/src/services/hermes/skill-runner-impl.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/skill-runner-impl.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-runner.ts'), 'utf-8');

describe('runSkillPlan structure', () => {
  it('exports runSkillPlan', () => {
    expect(SRC).toMatch(/export async function runSkillPlan/);
  });
  it('resolves args then partitions by toolConfirmRequired', () => {
    expect(SRC).toMatch(/resolveSkillArgs/);
    expect(SRC).toMatch(/partitionSteps/);
    expect(SRC).toMatch(/toolConfirmRequired/);
  });
  it('runs auto steps via runRegistryTool', () => {
    expect(SRC).toMatch(/runRegistryTool/);
  });
  it('batches confirm steps into a run_skill_actions PendingAction', () => {
    expect(SRC).toMatch(/setPendingAction/);
    expect(SRC).toMatch(/run_skill_actions/);
  });
  it('synthesizes a message via haiku, best-effort', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-runner-impl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add imports + runSkillPlan to skill-runner.ts**

Add to the TOP of `src/services/hermes/skill-runner.ts` (after the existing `import type { SkillStep }` line):
```ts
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { runRegistryTool, toolConfirmRequired } from '../../tools/index.js';
import { setPendingAction } from '../pending-actions.js';
import { resolveSkillArgs } from './arg-resolver.js';
import type { SkillDefinition } from '@prisma/client';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });
```
Add this function at the END of the file:
```ts
function asMessage(out: unknown): string {
  if (out && typeof out === 'object' && 'message' in out) {
    const m = (out as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

async function synthesize(synthesisPrompt: string, parts: string[]): Promise<string> {
  const joined = parts.filter(Boolean).join('\n');
  try {
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 500,
      system: `Ты — LifeOS. Дан результат выполнения шагов навыка. Слей их в один
дружелюбный ответ по инструкции навыка. Коротко, по делу, на русском.`,
      messages: [{ role: 'user', content: `Инструкция: ${synthesisPrompt}\n\nРезультаты:\n${joined}` }],
    });
    const block = res.content[0];
    if (block && block.type === 'text' && block.text.trim()) return block.text.trim();
  } catch (err) {
    console.warn('[hermes:runner:synthesize] failed:',
      err instanceof Error ? err.message : err);
  }
  return joined || 'Готово.';
}

/**
 * Deterministic two-phase execution for an ACTION skill (has confirm steps).
 * Phase 1: run auto steps now (runRegistryTool). Phase 2: batch money/confirm
 * steps into ONE run_skill_actions PendingAction (executed after «да»).
 * Returns the user-facing reply. Best-effort throughout.
 */
export async function runSkillPlan(
  userId: string,
  skill: SkillDefinition,
  userMessage: string,
): Promise<string> {
  const plan = (skill.plan as unknown as SkillStep[]) ?? [];
  const args = await resolveSkillArgs(plan, userMessage);
  const { auto, confirm } = partitionSteps(plan, args, toolConfirmRequired);

  // Phase 1 — auto steps run immediately (best-effort per step).
  const parts: string[] = [];
  for (const step of auto) {
    try {
      const out = await runRegistryTool(step.toolName, step.args, { userId });
      const m = asMessage(out);
      if (m) parts.push(m);
    } catch (err) {
      console.warn(`[hermes:runner:auto:${step.toolName}] failed:`,
        err instanceof Error ? err.message : err);
    }
  }

  let message = await synthesize(skill.synthesis, parts);

  // Phase 2 — batch confirm steps into one PendingAction (money never
  // auto-runs; executes only after the user's «да»).
  if (confirm.length > 0) {
    const list = confirm
      .map((s) => `${s.toolName}(${JSON.stringify(s.args)})`)
      .join(', ');
    const confirmationText = `Навык «${skill.name}»: подтвердить действия — ${list}? (да/нет)`;
    try {
      await setPendingAction(
        userId,
        'run_skill_actions',
        { steps: confirm, skillName: skill.name },
        confirmationText,
      );
      message = `${message}\n\n⚠️ ${confirmationText}`;
    } catch (err) {
      console.warn('[hermes:runner:pending] failed:', err);
    }
  }
  return message;
}
```
NOTE: `toolConfirmRequired(name, args)` has signature `(name, input)` — it's passed directly as the `needsConfirmOf` predicate (matches `(toolName, args) => boolean`). Confirm `SkillDefinition.plan` is `Json` (cast `as unknown as SkillStep[]`). If `setPendingAction` requires more/fewer args, match its real signature.

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-runner-impl.test.ts src/services/hermes/skill-runner.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/skill-runner.ts src/services/hermes/skill-runner-impl.test.ts
git commit -F - <<'EOF'
feat(v2-h2): runSkillPlan two-phase action runner (B3)

Phase 1 runs auto steps via runRegistryTool + haiku synthesis. Phase 2
batches money/confirm steps into one run_skill_actions PendingAction
(executed only after «да»). Best-effort throughout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B4: hermes/index.ts re-exports

**Files:**
- Modify: `packages/server/src/services/hermes/index.ts`
- Test: `packages/server/src/services/hermes/h2-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/h2-index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runSkillPlan, resolveSkillArgs, partitionSteps } from './index.js';

describe('hermes/index H2 re-exports', () => {
  it('exposes runSkillPlan, resolveSkillArgs, partitionSteps', () => {
    expect(typeof runSkillPlan).toBe('function');
    expect(typeof resolveSkillArgs).toBe('function');
    expect(typeof partitionSteps).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add re-exports**

In `src/services/hermes/index.ts`, add (near the other re-exports):
```ts
export { runSkillPlan, partitionSteps } from './skill-runner.js';
export { resolveSkillArgs, parseArgsResponse } from './arg-resolver.js';
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-index.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/index.ts src/services/hermes/h2-index.test.ts
git commit -F - <<'EOF'
feat(v2-h2): re-export runSkillPlan + resolveSkillArgs (B4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C1: orchestrator composition routing → runSkillPlan vs seed

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Test: `packages/server/src/services/hermes/h2-routing.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/h2-routing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('orchestrator H2 composition routing', () => {
  it('imports runSkillPlan', () => {
    expect(ORCH).toMatch(/runSkillPlan/);
  });
  it('routes a confirm-containing skill to runSkillPlan (deterministic)', () => {
    expect(ORCH).toMatch(/toolConfirmRequired/);
    // a skillReply path that bypasses the agent loop
    expect(ORCH).toMatch(/skillReply/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-routing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify the Hermes block + reply guard**

In `src/services/jarvis-orchestrator.ts`:
- Add `runSkillPlan` to the existing hermes import:
```ts
import { routeToSkill, buildSkillInstruction, getHermesStore, runSkillPlan, type SkillSpec } from './hermes/index.js';
```
(`toolConfirmRequired` is already imported from `../tools/index.js` — confirm it; if not, add it.)
- Locate the B4 Hermes block (`let hermesForceTools = false; if (isV2HermesEnabled(userId)) { ... routeToSkill ... if (matched) { const spec = {...}; system = system + ... buildSkillInstruction(spec); hermesForceTools = true; ... } }`). Replace the `if (matched) {...}` body so it routes by composition, and add a `skillReply` variable declared alongside `hermesForceTools`:
```ts
  let hermesForceTools = false;
  let skillReply: string | null = null;
  if (isV2HermesEnabled(userId)) {
    try {
      const skills = await getHermesStore().activeSkills(userId);
      const matched = await routeToSkill(userId, text, skills);
      if (matched) {
        const plan = (matched.plan as unknown as { toolName: string }[]) ?? [];
        const hasConfirm = plan.some((s) => toolConfirmRequired(s.toolName, {}));
        if (hasConfirm) {
          // v2 H2 — action skill: deterministic two-phase runner (money
          // steps batch into a confirm); bypasses the agent loop.
          skillReply = await runSkillPlan(userId, matched, text);
          void getHermesStore().bumpUsage(matched.id);
        } else {
          // read/write-non-money skill: existing agent-loop seed (unchanged).
          const spec: SkillSpec = {
            name: matched.name,
            description: matched.description,
            triggers: matched.triggers,
            plan: matched.plan as unknown as SkillSpec['plan'],
            synthesis: matched.synthesis,
          };
          system = system + '\n\n' + buildSkillInstruction(spec);
          hermesForceTools = true;
          void getHermesStore().bumpUsage(matched.id);
        }
      }
    } catch (err) {
      console.warn('[hermes:run-seed] failed:', err);
    }
  }
```
- Find the `let reply: string;` + `try { reply = await runAgent({...}); }` that follows. Guard it so a deterministic skill reply bypasses the agent loop:
```ts
  let reply: string;
  if (skillReply !== null) {
    reply = skillReply;
  } else {
    try {
      reply = await runAgent({
        // ... EXISTING runAgent args unchanged ...
      });
    } catch (agentErr) {
      // ... EXISTING catch/degradation unchanged ...
    }
  }
```
IMPORTANT: wrap ONLY the existing `let reply; try { reply = await runAgent(...) } catch {...}` in the `if (skillReply !== null) { reply = skillReply; } else { <existing> }`. Do NOT alter the runAgent args or the catch body. If the existing structure differs, preserve it and only add the `skillReply` short-circuit.

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-routing.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/jarvis-orchestrator.ts src/services/hermes/h2-routing.test.ts
git commit -F - <<'EOF'
feat(v2-h2): orchestrator composition routing (C1)

Matched skill with any confirm step → deterministic runSkillPlan (bypasses
the agent loop, money batches into a confirm); otherwise the existing
agent-loop seed (zero regression for read/write skills).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C2: runConfirmedAction `run_skill_actions` branch

**Files:**
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Test: `packages/server/src/services/hermes/h2-confirm.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/h2-confirm.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('runConfirmedAction run_skill_actions branch', () => {
  it('handles run_skill_actions by looping runRegistryTool over steps', () => {
    expect(ORCH).toMatch(/run_skill_actions/);
    // the branch loops the batched steps
    expect(ORCH).toMatch(/input\.steps|steps\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-confirm.test.ts`
Expected: FAIL (run_skill_actions present in C1's PendingAction string but the branch loop with `input.steps`/`steps` may already match — if it passes early, still add the real branch in Step 3; re-run to confirm).

- [ ] **Step 3: Add the branch to runConfirmedAction**

In `src/services/jarvis-orchestrator.ts`, find `export async function runConfirmedAction(userId, action, input)`. At the TOP of its `try` block (before the existing `runRegistryTool(action, input, {userId})` call), add a branch for the batched skill actions:
```ts
    // v2 H2 — batched skill action steps (from runSkillPlan Phase 2).
    if (action === 'run_skill_actions') {
      const steps = Array.isArray((input as { steps?: unknown }).steps)
        ? ((input as { steps: Array<{ toolName: string; args: Record<string, unknown> }> }).steps)
        : [];
      const results: string[] = [];
      for (const s of steps) {
        try {
          const out = (await runRegistryTool(s.toolName, s.args, { userId })) as { message?: string };
          results.push(out.message ?? 'Готово.');
        } catch (err) {
          console.warn(`[jarvis] skill action ${s.toolName} failed:`,
            err instanceof Error ? err.message : err);
          results.push(`Не получилось: ${s.toolName}.`);
        }
      }
      const message = results.join('\n') || 'Готово.';
      await saveTurn(userId, '(подтверждено)', message);
      return message;
    }
```
(Keep the rest of `runConfirmedAction` unchanged — it falls through to the existing single-tool path for all other actions. `saveTurn` and `runRegistryTool` are already in scope in this file.)

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/h2-confirm.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/jarvis-orchestrator.ts src/services/hermes/h2-confirm.test.ts
git commit -F - <<'EOF'
feat(v2-h2): runConfirmedAction run_skill_actions branch (C2)

On «да» for a batched skill, loop the stored steps through runRegistryTool
(audit + zod per step) and concatenate results. Money executes only here.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task E1: integration test + full verify + progress tracker

**Files:**
- Create: `packages/server/src/__integration__/v2-hermes-action-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

- [ ] **Step 1: Write the integration test (structural)**

Create `packages/server/src/__integration__/v2-hermes-action-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const RUNNER = readFileSync(join(process.cwd(), 'src/services/hermes/skill-runner.ts'), 'utf-8');

describe('v2 H2 action-skill flow', () => {
  it('action skills route to the deterministic runner; read skills keep the seed', () => {
    expect(ORCH).toContain('runSkillPlan');
    expect(ORCH).toContain('buildSkillInstruction'); // read/write path still present
    expect(ORCH).toContain('skillReply');
  });
  it('money steps execute only via confirm (batched run_skill_actions)', () => {
    expect(RUNNER).toMatch(/run_skill_actions/);
    expect(RUNNER).toMatch(/setPendingAction/);
    // auto phase uses runRegistryTool; runner never calls money tools directly
    // outside the batched PendingAction
    expect(RUNNER).toMatch(/runRegistryTool/);
  });
  it('confirm execution loops runRegistryTool in runConfirmedAction', () => {
    expect(ORCH).toMatch(/action === 'run_skill_actions'/);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/__integration__/v2-hermes-action-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run 2>&1 | tail -20
```
Expected: tsc clean; all tests pass (baseline 1752 + H2 ~45-55). `[...] failed:` / Prisma FK stderr lines are intentional best-effort logs, not failures — only the final summary matters. If any test genuinely FAILS, STOP and report BLOCKED.

- [ ] **Step 4: Update the progress tracker**

In `docs/plan/v2-memory-proactivity-scope.md`, add an "H2 — done" entry mirroring the B4/Reflector entries: action skills with money/confirm steps now execute via a deterministic two-phase runner (auto steps run via runRegistryTool + haiku synthesis; money batched into one run_skill_actions PendingAction confirmed by «да»); composition routing keeps read/write skills on the existing agent-loop seed (zero regression); arg-resolver (haiku) fills step args from the message; no new flag/table/migration; files `src/services/hermes/` (arg-resolver, skill-runner) + orchestrator routing + runConfirmedAction branch; ~7 tasks. Match the doc's format.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/__integration__/v2-hermes-action-flow.test.ts \
  /Users/berikkurmangoliev/Desktop/LifeOS/docs/plan/v2-memory-proactivity-scope.md
git commit -F - <<'EOF'
test(v2-h2): action-flow integration + progress tracker (E1)

Structural integration: action skills → deterministic runner; read/write
skills keep the seed; money executes only via the batched run_skill_actions
confirm branch. Marks H2 done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Rollout (AFTER all tasks green — explicit Berik approval per step)
1. **Push** (on "push"): `git push origin main`.
2. **Deploy**: NO migration. Verify Online (health 200).
3. (Flag `FEATURE_V2_HERMES` already ON for Berik.)
4. **SMOKE**: create an action skill — "сделай навык вечерний разбор: покажи задачи и запиши расход на ужин" → run it ("вечерний разбор, ужин 3000") → read step runs + "⚠️ подтвердить: add-expense(...)? да/нет" → «да» → expense recorded (check `Expense` row). AND re-run "утренний брифинг" → still works (no regression).

---

## Self-Review (against the spec)
**Spec coverage:**
- §2 full action skills incl. money → B3 runSkillPlan + C2 confirm branch ✓
- §3.1 route by composition (no regression) → C1 (hasConfirm → runner else seed) ✓
- §3.2 two-phase (auto run + money batch) → B3 ✓
- §3.3 confirm execution loops runRegistryTool → C2 ✓
- arg-templating → B1 resolveSkillArgs ✓
- §4 money only via «да», validateSkillTools unchanged, best-effort → B3/C2 ✓
- §6 no new table → confirmed (no schema task) ✓
- §7 testing (pure partitionSteps/parseArgsResponse + structural + integration, zero vi.mock) → all ✓

**Placeholder scan:** none. The "match the real signature" notes (B3 setPendingAction, C1 existing runAgent args) are explicit guard instructions, not silent placeholders — concrete code provided.

**Type consistency:** `SkillStep{toolName,argTemplate?}` (hermes/types) used B1/B2/B3. `RunnerStep{toolName,args}` defined B2, used B3/C2. `partitionSteps(plan, args, needsConfirmOf)` B2 → B3 (passes `toolConfirmRequired`). `resolveSkillArgs(plan, userMessage)` B1 → B3. `runSkillPlan(userId, skill, userMessage)` B3 → C1. PendingAction `{action:'run_skill_actions', input:{steps,skillName}}` set in B3, consumed in C2. `runRegistryTool(name, args, {userId})` consistent B3/C2.

**Total:** 7 tasks (B1–B4, C1, C2, E1). No schema/migration. Mirrors B1–B4 granularity.
```
