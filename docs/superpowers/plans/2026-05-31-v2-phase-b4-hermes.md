# v2 Phase B4 — Hermes (Composable Skills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bot compose, save, and run reusable *skills* (named recipes over existing tools) — proactively proposed or explicitly created — without any codegen.

**Architecture:** A skill is DATA (`SkillDefinition`: plan of existing tool names + synthesis text). Running a skill = the orchestrator appends a *seeded instruction* (`buildSkillInstruction`) to the system prompt and lets the EXISTING agent loop execute it, so money/write steps inherit their existing confirm gates. Creation: explicit `create_skill` tool (needsConfirm) + proactive `detectSkillOpportunity` detector over `ToolCall` history. A skill-router (exact name + Voyage cosine on triggers) picks the skill for a turn.

**Tech Stack:** TypeScript strict, Prisma 6.19 + Postgres, Anthropic haiku, Voyage embeddings (`embedQuery`), vitest (structural readFileSync+grep + pure unit, zero vi.mock), feature flag `isV2HermesEnabled`.

**Spec:** `docs/superpowers/specs/2026-05-31-v2-phase-b4-hermes-design.md` (approved by Berik 2026-05-31).

---

## CRITICAL repo facts (read before any task)
- Work on branch **`main`** in **`/Users/berikkurmangoliev/Desktop/LifeOS`**. NOT the worktree under `.claude/worktrees/...` (it's a divergent branch). The shell cwd may reset between commands — start EVERY bash command with `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && ...`.
- Tools live in **`src/tools/`** (NOT `src/services/tools/`). `Tool` interface in `src/tools/_types.ts`: `{ name, description, category, schema (zod), needsConfirm, sideEffects, handler, examples?, integrationRequirement? }`. Registry: `ALL_TOOLS` array + `export const registry: ReadonlyMap<string, Tool>` + `registryToolNames()` + `capabilityText()` in `src/tools/index.ts`.
- Migrations MUST be **standard** `prisma/migrations/<timestamp>_name/migration.sql` folders (idempotent `CREATE TABLE IF NOT EXISTS` + `DO $$ pg_constraint guard $$` like B1). **NEVER** a `manual/` subdir — it breaks `prisma migrate deploy` with P3015 (this exact bug hit B3).
- Local docker DB: container `server-postgres-1`, db `lifeos_dev`. Apply a migration locally with `docker exec -i server-postgres-1 psql -U postgres -d lifeos_dev < <file>`.
- `.env` `DATABASE_URL` is **PRODUCTION**. NEVER run `prisma migrate`/`db push` (would hit prod). Only `npx prisma generate` (schema-only, safe).
- Commit per step with heredoc message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. LOCAL commits only — never `git push`.
- Commands: `npx tsc --noEmit` (typecheck), `npx vitest run <path>` (single), `npx vitest run` (full).
- Skill execution is via **seeded instruction into the existing agent loop** — `skill-runner` does NOT call tool handlers directly.

## File Structure
| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `SkillDefinition` model + `User.skills` reverse relation |
| `prisma/migrations/20260531210000_v2_hermes_skills/migration.sql` | idempotent standard migration |
| `src/services/hermes/types.ts` | types + pure helpers (validateSkillTools, parseSkillSpec, BLOCKLIST, buildSkillInstruction) |
| `src/services/hermes/skill-builder.ts` | haiku drafts (explicit + proactive) |
| `src/services/hermes/skill-router.ts` | match message → skill (exact + Voyage cosine) |
| `src/services/hermes/postgres-impl.ts` | `HermesStore` CRUD + validate-on-create |
| `src/services/hermes/index.ts` | `getHermesStore()` singleton + re-exports |
| `src/tools/create-skill.ts` | explicit-creation tool (needsConfirm) |
| `src/tools/index.ts` | register `createSkillTool` |
| `src/lib/feature-flags.ts` | `isV2HermesEnabled` |
| `src/services/jarvis-orchestrator.ts` | run-seed wiring (route → append instruction) |
| `src/services/v2-proactivity-engine.ts` | `skill_suggestion` source + `detectSkillOpportunity` |
| `src/services/telegram-bot.ts` | `/skills` command |
| `src/__integration__/v2-hermes-flow.test.ts` | structural integration |

---

## Task A1: SkillDefinition model + standard migration folder

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/prisma/migrations/20260531210000_v2_hermes_skills/migration.sql`
- Test: `packages/server/src/services/hermes/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
const MIG = readFileSync(
  join(process.cwd(),
    'prisma/migrations/20260531210000_v2_hermes_skills/migration.sql'),
  'utf-8');

describe('B4 schema — SkillDefinition model', () => {
  it('declares the model with required fields', () => {
    expect(SCHEMA).toMatch(/model SkillDefinition \{/);
    for (const f of ['triggers', 'plan', 'synthesis', 'source',
                     'active', 'useCount', 'lastUsedAt']) {
      expect(SCHEMA).toContain(f);
    }
  });
  it('User has skills reverse relation', () => {
    expect(SCHEMA).toMatch(/skills\s+SkillDefinition\[\]/);
  });
});

describe('B4 schema — idempotent standard migration', () => {
  it('uses IF NOT EXISTS + pg_constraint guard', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS "SkillDefinition"/);
    expect(MIG).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(MIG).toMatch(/pg_constraint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/schema.test.ts`
Expected: FAIL — migration file missing.

- [ ] **Step 3: Add the model + reverse relation**

In `prisma/schema.prisma`, add to `model User` near the other reverse relations (e.g. after `correctionLogs CorrectionLog[]`):
```prisma
  skills         SkillDefinition[]
```
Add the model at the end of the file:
```prisma
model SkillDefinition {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  name        String
  description String
  triggers    String[]
  plan        Json
  synthesis   String
  source      String    // 'proactive' | 'explicit'
  active      Boolean   @default(true)
  useCount    Int       @default(0)
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@unique([userId, name])
  @@index([userId, active])
}
```

- [ ] **Step 4: Write the standard migration**

Create `prisma/migrations/20260531210000_v2_hermes_skills/migration.sql`:
```sql
-- v2 Phase B4 — Hermes composable skills: SkillDefinition
-- Standard prisma migration folder (applied by Dockerfile `migrate deploy`).
-- Idempotent (IF NOT EXISTS + pg_constraint guard) — safe to re-run.

CREATE TABLE IF NOT EXISTS "SkillDefinition" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "triggers"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "plan"        JSONB NOT NULL,
  "synthesis"   TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "useCount"    INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SkillDefinition_userId_fkey') THEN
    ALTER TABLE "SkillDefinition"
      ADD CONSTRAINT "SkillDefinition_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SkillDefinition_userId_name_key"
  ON "SkillDefinition"("userId", "name");
CREATE INDEX IF NOT EXISTS "SkillDefinition_userId_active_idx"
  ON "SkillDefinition"("userId", "active");
```

- [ ] **Step 5: Apply locally (docker only) + regenerate client**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
docker exec -i server-postgres-1 psql -U postgres -d lifeos_dev < prisma/migrations/20260531210000_v2_hermes_skills/migration.sql
npx prisma generate
```
Expected: `CREATE TABLE`/`CREATE INDEX`/`DO` succeed; re-running the psql line is a NOTICE no-op (verify idempotency). `prisma generate` adds the `skillDefinition` delegate. Do NOT run any prisma DB command. If docker fails, report as concern but continue (doesn't block tsc/tests).

- [ ] **Step 6: Run test + tsc**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/schema.test.ts && npx tsc --noEmit
```
Expected: test PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add prisma/schema.prisma \
  prisma/migrations/20260531210000_v2_hermes_skills/migration.sql \
  src/services/hermes/schema.test.ts
git commit -F - <<'EOF'
feat(v2-b4): SkillDefinition model + standard migration (A1)

Hermes skills table (plan/triggers/synthesis/source). Standard prisma
migration folder + idempotent SQL (IF NOT EXISTS + pg_constraint guard);
NOT a manual/ dir (B3 P3015 lesson). User.skills reverse relation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B1: hermes/types.ts + pure helpers

**Files:**
- Create: `packages/server/src/services/hermes/types.ts`
- Test: `packages/server/src/services/hermes/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
  BLOCKLIST,
  MAX_STEPS,
  SkillValidationError,
} from './types.js';

const KNOWN = new Set(['get-tasks', 'get-budget', 'add-expense', 'get-calendar']);
const CAT = (n: string): string =>
  n === 'add-expense' ? 'finance' : n.startsWith('get-') ? 'info' : 'system';

describe('validateSkillTools', () => {
  const ok = [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }];
  it('passes a valid read+write plan', () => {
    expect(() => validateSkillTools(ok, KNOWN, CAT)).not.toThrow();
  });
  it('rejects unknown tool', () => {
    expect(() => validateSkillTools([{ toolName: 'nope' }], KNOWN, CAT))
      .toThrow(SkillValidationError);
  });
  it('rejects empty plan', () => {
    expect(() => validateSkillTools([], KNOWN, CAT)).toThrow(SkillValidationError);
  });
  it('rejects > MAX_STEPS', () => {
    const big = Array.from({ length: MAX_STEPS + 1 }, () => ({ toolName: 'get-tasks' }));
    expect(() => validateSkillTools(big, KNOWN, CAT)).toThrow(SkillValidationError);
  });
  it('rejects a skill referencing another skill', () => {
    expect(() => validateSkillTools([{ toolName: 'skill_abc' }], KNOWN, CAT))
      .toThrow(SkillValidationError);
  });
  it('rejects a blocklisted category (pet)', () => {
    const known2 = new Set([...KNOWN, 'feed-pet']);
    const cat2 = (n: string): string => (n === 'feed-pet' ? 'pet' : CAT(n));
    expect(() => validateSkillTools([{ toolName: 'feed-pet' }], known2, cat2))
      .toThrow(SkillValidationError);
  });
});

describe('parseSkillSpec', () => {
  it('parses a valid spec', () => {
    const s = parseSkillSpec(JSON.stringify({
      name: 'Утренний брифинг', description: 'утром', triggers: ['брифинг'],
      plan: [{ toolName: 'get-tasks' }], synthesis: 'слей',
    }));
    expect(s?.name).toBe('Утренний брифинг');
    expect(s?.plan).toHaveLength(1);
  });
  it('strips markdown fences', () => {
    const s = parseSkillSpec('```json\n{"name":"X","description":"d",'
      + '"triggers":[],"plan":[{"toolName":"get-tasks"}],"synthesis":"s"}\n```');
    expect(s?.name).toBe('X');
  });
  it('returns null on garbage / missing fields', () => {
    expect(parseSkillSpec('not json')).toBeNull();
    expect(parseSkillSpec(JSON.stringify({ name: 'X' }))).toBeNull();
    expect(parseSkillSpec('')).toBeNull();
  });
});

describe('buildSkillInstruction', () => {
  it('renders plan + synthesis into an instruction string', () => {
    const out = buildSkillInstruction({
      name: 'Брифинг', description: 'd', triggers: [],
      plan: [{ toolName: 'get-tasks' }, { toolName: 'get-budget' }],
      synthesis: 'Соедини задачи и бюджет.',
    } as any);
    expect(out).toContain('Брифинг');
    expect(out).toContain('get-tasks');
    expect(out).toContain('get-budget');
    expect(out).toContain('Соедини задачи и бюджет.');
    expect(out).toMatch(/подтвержд/i); // reminds about confirm rules
  });
});

describe('BLOCKLIST', () => {
  it('blocks pet category and photo_calorie', () => {
    expect(BLOCKLIST.categories.has('pet')).toBe(true);
    expect(BLOCKLIST.categories.has('photo_calorie')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types.ts**

Create `packages/server/src/services/hermes/types.ts`:
```ts
/**
 * v2.0 Phase B4 — Hermes composable skills: types + pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b4-hermes-design.md
 *
 * A skill is DATA (plan over EXISTING tools + synthesis). Pure helpers
 * are exported for unit testing without DB/Claude/Voyage.
 */

export interface SkillStep {
  toolName: string;
  argTemplate?: Record<string, unknown>;
}

export interface SkillSpec {
  name: string;
  description: string;
  triggers: string[];
  plan: SkillStep[];
  synthesis: string;
}

export const MAX_STEPS = 8;

/** Capabilities a skill may NOT compose (Berik: всё кроме питомца и фото). */
export const BLOCKLIST = {
  categories: new Set<string>(['pet', 'photo_calorie']),
  toolNames: new Set<string>(),
};

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

/**
 * Validate a plan against the live registry + blocklist. Throws
 * SkillValidationError on: empty, > MAX_STEPS, unknown tool, blocklisted
 * category/name, or a skill referencing another skill (skill_* prefix).
 */
export function validateSkillTools(
  plan: SkillStep[],
  knownToolNames: ReadonlySet<string>,
  categoryOf: (toolName: string) => string,
): void {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new SkillValidationError('План навыка пуст.');
  }
  if (plan.length > MAX_STEPS) {
    throw new SkillValidationError(`Слишком много шагов (> ${MAX_STEPS}).`);
  }
  for (const step of plan) {
    const n = step?.toolName;
    if (typeof n !== 'string' || n.length === 0) {
      throw new SkillValidationError('Шаг без toolName.');
    }
    if (n.startsWith('skill_')) {
      throw new SkillValidationError('Навык не может вызывать другой навык.');
    }
    if (BLOCKLIST.toolNames.has(n)) {
      throw new SkillValidationError(`Инструмент ${n} запрещён в навыках.`);
    }
    if (!knownToolNames.has(n)) {
      throw new SkillValidationError(`Неизвестный инструмент: ${n}.`);
    }
    if (BLOCKLIST.categories.has(categoryOf(n))) {
      throw new SkillValidationError(`Инструмент ${n} в запрещённой категории.`);
    }
  }
}

/** Defensive parser for the haiku-drafted skill spec. Never throws —
 *  returns null on any malformed / incomplete input. */
export function parseSkillSpec(raw: string): SkillSpec | null {
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
  if (typeof o.name !== 'string' || typeof o.description !== 'string') return null;
  if (typeof o.synthesis !== 'string') return null;
  if (!Array.isArray(o.plan) || o.plan.length === 0) return null;
  const plan: SkillStep[] = [];
  for (const s of o.plan) {
    if (!s || typeof s !== 'object') return null;
    const tn = (s as Record<string, unknown>).toolName;
    if (typeof tn !== 'string') return null;
    const step: SkillStep = { toolName: tn };
    const at = (s as Record<string, unknown>).argTemplate;
    if (at && typeof at === 'object') step.argTemplate = at as Record<string, unknown>;
    plan.push(step);
  }
  const triggers = Array.isArray(o.triggers)
    ? o.triggers.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    name: o.name.slice(0, 80),
    description: o.description.slice(0, 280),
    triggers,
    plan,
    synthesis: o.synthesis.slice(0, 1000),
  };
}

/**
 * Render a skill into a seeded instruction appended to the system prompt.
 * The EXISTING agent loop executes it — so write/money steps still hit
 * their own confirm gates (we only remind the model to respect them).
 */
export function buildSkillInstruction(spec: SkillSpec): string {
  const steps = spec.plan
    .map((s, i) => `${i + 1}. ${s.toolName}`)
    .join(' → ');
  return [
    `Пользователь запустил навык «${spec.name}».`,
    `План: ${steps}.`,
    `Затем: ${spec.synthesis}`,
    `Соблюдай обычные правила подтверждения (read — сразу; деньги/запись — спрашивай подтверждение как всегда).`,
  ].join('\n');
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/types.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/types.ts src/services/hermes/types.test.ts
git commit -F - <<'EOF'
feat(v2-b4): hermes types + pure helpers (B1)

SkillStep/SkillSpec, validateSkillTools (empty/cap/unknown/blocklist/no-
recursion), parseSkillSpec (defensive, never throws), buildSkillInstruction
(seeded instruction for the existing agent loop), BLOCKLIST (pet/photo).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B2: skill-builder.ts — haiku draft generators

**Files:**
- Create: `packages/server/src/services/hermes/skill-builder.ts`
- Test: `packages/server/src/services/hermes/skill-builder.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/skill-builder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-builder.ts'), 'utf-8');

describe('skill-builder structure', () => {
  it('exports both draft generators', () => {
    expect(SRC).toMatch(/export async function buildSkillFromRequest/);
    expect(SRC).toMatch(/export async function proposeSkillFromPattern/);
  });
  it('uses haiku + parseSkillSpec', () => {
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/parseSkillSpec/);
  });
  it('feeds the available tool list into the prompt', () => {
    expect(SRC).toMatch(/registryToolNames|capabilityText/);
  });
  it('is best-effort — returns null on failure, never throws', () => {
    expect(SRC).toMatch(/return null/);
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-builder.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement skill-builder.ts**

Create `packages/server/src/services/hermes/skill-builder.ts`:
```ts
/**
 * v2.0 Phase B4 — Hermes skill drafts via Claude haiku. Best-effort:
 * never throws; returns null on any failure. Mirrors user-axes/analyze-message.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { registryToolNames } from '../../tools/index.js';
import { parseSkillSpec, type SkillSpec } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

function toolMenu(): string {
  return registryToolNames().join(', ');
}

const SYS = (menu: string): string => `Ты — конструктор НАВЫКОВ LifeOS. Навык —
это рецепт из СУЩЕСТВУЮЩИХ инструментов. Доступные инструменты: ${menu}.
Верни ТОЛЬКО валидный JSON формата:
{"name":"...","description":"когда применять","triggers":["фраза1","фраза2"],
"plan":[{"toolName":"имя-из-списка"}],"synthesis":"как слить результаты в один ответ"}
Используй ТОЛЬКО инструменты из списка. Без markdown, без пояснений.`;

async function draft(userContent: string): Promise<SkillSpec | null> {
  try {
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 600,
      system: SYS(toolMenu()),
      messages: [{ role: 'user', content: userContent }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return null;
    return parseSkillSpec(block.text);
  } catch (err) {
    console.warn('[hermes:builder] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}

/** Explicit path: user asked "сделай навык, который ...". */
export async function buildSkillFromRequest(
  _userId: string,
  userText: string,
): Promise<SkillSpec | null> {
  return draft(`Сделай навык по запросу пользователя: «${userText}».`);
}

/** Proactive path: a recurring cluster of co-used tools → propose a skill. */
export async function proposeSkillFromPattern(
  _userId: string,
  toolCluster: string[],
): Promise<SkillSpec | null> {
  if (toolCluster.length < 2) return null;
  return draft(
    `Пользователь часто вызывает вместе: ${toolCluster.join(', ')}. ` +
    `Предложи удобный навык, объединяющий их.`,
  );
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-builder.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (If `registryToolNames` import path is wrong, check `src/tools/index.ts` exports — it is exported there.)

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/skill-builder.ts src/services/hermes/skill-builder.test.ts
git commit -F - <<'EOF'
feat(v2-b4): skill-builder haiku drafts (B2)

buildSkillFromRequest (explicit) + proposeSkillFromPattern (proactive).
Haiku given the live tool menu → parseSkillSpec. Best-effort: null on
failure, never throws.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B3: skill-router.ts — match message → skill

**Files:**
- Create: `packages/server/src/services/hermes/skill-router.ts`
- Test: `packages/server/src/services/hermes/skill-router.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/skill-router.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/skill-router.ts'), 'utf-8');

describe('skill-router structure', () => {
  it('exports routeToSkill', () => {
    expect(SRC).toMatch(/export async function routeToSkill/);
  });
  it('has an exact-name fast path', () => {
    expect(SRC).toMatch(/toLowerCase\(\)/);
    expect(SRC).toMatch(/\.name/);
  });
  it('gates Voyage on embeddingsEnabled + uses cosine threshold', () => {
    expect(SRC).toMatch(/embeddingsEnabled/);
    expect(SRC).toMatch(/embedQuery/);
    expect(SRC).toMatch(/cosineSimilarity/);
    expect(SRC).toMatch(/0\.8/);
  });
  it('is best-effort — returns null on failure', () => {
    expect(SRC).toMatch(/catch/);
    expect(SRC).toMatch(/return null/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-router.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement skill-router.ts**

Create `packages/server/src/services/hermes/skill-router.ts`:
```ts
/**
 * v2.0 Phase B4 — Hermes skill router. Picks the skill for a turn:
 * exact-name match first (cheap), else Voyage cosine of the message vs
 * each skill's triggers/description. Best-effort → null.
 */

import { embedQuery, embeddingsEnabled } from '../embeddings.js';
import { cosineSimilarity } from '../procedural-memory.js';
import type { SkillDefinition } from '@prisma/client';

const ROUTE_THRESHOLD = 0.8;

export async function routeToSkill(
  _userId: string,
  text: string,
  activeSkills: SkillDefinition[],
): Promise<SkillDefinition | null> {
  const t = (text ?? '').trim().toLowerCase();
  if (t.length === 0 || activeSkills.length === 0) return null;

  // 1. Exact-name fast path (also covers "/skills run <name>").
  for (const s of activeSkills) {
    if (t === s.name.toLowerCase() || t.includes(s.name.toLowerCase())) {
      return s;
    }
  }

  // 2. Semantic match via Voyage. Best-effort.
  if (!embeddingsEnabled()) return null;
  try {
    const q = await embedQuery(text);
    if (!q || q.length === 0) return null;
    let best: SkillDefinition | null = null;
    let bestSim = -1;
    for (const s of activeSkills) {
      const probe = [s.name, s.description, ...(s.triggers ?? [])].join('. ');
      const emb = await embedQuery(probe);
      if (!emb || emb.length === 0) continue;
      const sim = cosineSimilarity(q, emb);
      if (sim > bestSim) { bestSim = sim; best = s; }
    }
    return bestSim >= ROUTE_THRESHOLD ? best : null;
  } catch (err) {
    console.warn('[hermes:router] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/skill-router.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (`SkillDefinition` type exists on `@prisma/client` after A1 `prisma generate`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/skill-router.ts src/services/hermes/skill-router.test.ts
git commit -F - <<'EOF'
feat(v2-b4): skill-router exact + Voyage cosine (B3)

routeToSkill: exact-name fast path, else semantic match (embedQuery +
cosineSimilarity >= 0.8), gated by embeddingsEnabled. Best-effort → null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B4: postgres-impl.ts — HermesStore CRUD + validate-on-create

**Files:**
- Create: `packages/server/src/services/hermes/postgres-impl.ts`
- Test: `packages/server/src/services/hermes/postgres-impl.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/postgres-impl.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/postgres-impl.ts'), 'utf-8');

describe('PostgresHermes structure', () => {
  it('exports the class implementing HermesStore', () => {
    expect(SRC).toMatch(/export class PostgresHermes implements HermesStore/);
  });
  it('createSkill runs validateSkillTools against the live registry', () => {
    expect(SRC).toMatch(/validateSkillTools/);
    expect(SRC).toMatch(/registry/);
  });
  it('has list/get/delete/bumpUsage + active skills query', () => {
    for (const m of ['listSkills', 'getSkill', 'deleteSkill', 'bumpUsage',
                     'activeSkills']) {
      expect(SRC).toContain(m);
    }
  });
  it('writes plan as Prisma.InputJsonValue', () => {
    expect(SRC).toMatch(/Prisma\.InputJsonValue/);
  });
  it('is best-effort on reads (try/catch)', () => {
    expect(SRC).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/postgres-impl.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement postgres-impl.ts**

Create `packages/server/src/services/hermes/postgres-impl.ts`:
```ts
/**
 * v2.0 Phase B4 — PostgresHermes. CRUD for SkillDefinition with a
 * validate-on-create gate (validateSkillTools against the live registry +
 * blocklist). Reads are best-effort. Execution lives in the orchestrator,
 * not here.
 */

import { Prisma, type SkillDefinition } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { registry } from '../../tools/index.js';
import { validateSkillTools, type SkillSpec, type SkillStep } from './types.js';

export interface HermesStore {
  createSkill(userId: string, spec: SkillSpec, source: string): Promise<SkillDefinition>;
  listSkills(userId: string): Promise<SkillDefinition[]>;
  activeSkills(userId: string): Promise<SkillDefinition[]>;
  getSkill(userId: string, name: string): Promise<SkillDefinition | null>;
  deleteSkill(userId: string, name: string): Promise<boolean>;
  bumpUsage(id: string): Promise<void>;
}

function knownToolNames(): Set<string> {
  return new Set(registry.keys());
}
function categoryOf(toolName: string): string {
  return registry.get(toolName)?.category ?? 'unknown';
}

export class PostgresHermes implements HermesStore {
  async createSkill(
    userId: string,
    spec: SkillSpec,
    source: string,
  ): Promise<SkillDefinition> {
    // Validate plan against the LIVE registry + blocklist (throws on bad).
    validateSkillTools(spec.plan, knownToolNames(), categoryOf);

    // Friendly unique-name handling: suffix on clash instead of throwing.
    let name = spec.name;
    for (let i = 2; i <= 9; i++) {
      const clash = await prisma.skillDefinition.findUnique({
        where: { userId_name: { userId, name } },
      });
      if (!clash) break;
      name = `${spec.name} (${i})`;
    }

    return prisma.skillDefinition.create({
      data: {
        userId,
        name,
        description: spec.description,
        triggers: spec.triggers,
        plan: spec.plan as unknown as Prisma.InputJsonValue,
        synthesis: spec.synthesis,
        source,
      },
    });
  }

  async listSkills(userId: string): Promise<SkillDefinition[]> {
    try {
      return await prisma.skillDefinition.findMany({
        where: { userId },
        orderBy: { lastUsedAt: 'desc' },
      });
    } catch (err) {
      console.warn('[hermes:list] failed:', err);
      return [];
    }
  }

  async activeSkills(userId: string): Promise<SkillDefinition[]> {
    try {
      return await prisma.skillDefinition.findMany({
        where: { userId, active: true },
        orderBy: { useCount: 'desc' },
        take: 50,
      });
    } catch (err) {
      console.warn('[hermes:active] failed:', err);
      return [];
    }
  }

  async getSkill(userId: string, name: string): Promise<SkillDefinition | null> {
    try {
      return await prisma.skillDefinition.findUnique({
        where: { userId_name: { userId, name } },
      });
    } catch (err) {
      console.warn('[hermes:get] failed:', err);
      return null;
    }
  }

  async deleteSkill(userId: string, name: string): Promise<boolean> {
    try {
      await prisma.skillDefinition.delete({
        where: { userId_name: { userId, name } },
      });
      return true;
    } catch {
      return false;
    }
  }

  async bumpUsage(id: string): Promise<void> {
    try {
      await prisma.skillDefinition.update({
        where: { id },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (err) {
      console.warn('[hermes:bump] failed:', err);
    }
  }
}

export type { SkillStep };
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/postgres-impl.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. If `registry` import path is wrong, confirm `export const registry` in `src/tools/index.ts` (it is).

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/postgres-impl.ts src/services/hermes/postgres-impl.test.ts
git commit -F - <<'EOF'
feat(v2-b4): PostgresHermes CRUD + validate-on-create (B4)

createSkill validates the plan against the LIVE registry + blocklist
(validateSkillTools) before persisting; friendly name-clash suffixing.
list/active/get/delete/bumpUsage best-effort. No tool execution here.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task B5: hermes/index.ts — singleton + re-exports

**Files:**
- Create: `packages/server/src/services/hermes/index.ts`
- Test: `packages/server/src/services/hermes/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/hermes/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  getHermesStore,
  _resetHermesForTests,
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
  routeToSkill,
  buildSkillFromRequest,
} from './index.js';

describe('hermes/index', () => {
  it('getHermesStore returns a stable singleton', () => {
    _resetHermesForTests();
    const a = getHermesStore();
    const b = getHermesStore();
    expect(a).toBe(b);
    expect(typeof a.createSkill).toBe('function');
    expect(typeof a.activeSkills).toBe('function');
  });
  it('reset yields a fresh instance', () => {
    const a = getHermesStore();
    _resetHermesForTests();
    expect(getHermesStore()).not.toBe(a);
  });
  it('re-exports the public surface', () => {
    expect(typeof validateSkillTools).toBe('function');
    expect(typeof parseSkillSpec).toBe('function');
    expect(typeof buildSkillInstruction).toBe('function');
    expect(typeof routeToSkill).toBe('function');
    expect(typeof buildSkillFromRequest).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/index.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement index.ts**

Create `packages/server/src/services/hermes/index.ts`:
```ts
/**
 * v2.0 Phase B4 — Hermes public entry point. Lazy singleton + test reset.
 * Mirrors user-axes/index.ts and feedback/index.ts.
 */

export {
  type SkillStep,
  type SkillSpec,
  MAX_STEPS,
  BLOCKLIST,
  SkillValidationError,
  validateSkillTools,
  parseSkillSpec,
  buildSkillInstruction,
} from './types.js';

export { buildSkillFromRequest, proposeSkillFromPattern } from './skill-builder.js';
export { routeToSkill } from './skill-router.js';
export { PostgresHermes, type HermesStore } from './postgres-impl.js';

import { PostgresHermes } from './postgres-impl.js';
import type { HermesStore } from './postgres-impl.js';

let _instance: HermesStore | null = null;

export function getHermesStore(): HermesStore {
  if (!_instance) _instance = new PostgresHermes();
  return _instance;
}

export function _resetHermesForTests(): void {
  _instance = null;
}
```

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/index.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/hermes/index.ts src/services/hermes/index.test.ts
git commit -F - <<'EOF'
feat(v2-b4): hermes/index singleton + re-exports (B5)

getHermesStore() lazy singleton + _resetHermesForTests. Re-exports the
public surface (validate/parse/instruction/router/builder). Mirrors
user-axes + feedback index pattern.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C1: create_skill tool + register

**Files:**
- Create: `packages/server/src/tools/create-skill.ts`
- Modify: `packages/server/src/tools/index.ts`
- Test: `packages/server/src/tools/create-skill.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/tools/create-skill.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/tools/create-skill.ts'), 'utf-8');
const IDX = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');

describe('create-skill tool', () => {
  it('exports createSkillTool', () => {
    expect(SRC).toMatch(/export const createSkillTool/);
  });
  it('needs confirmation (write to a saved skill)', () => {
    expect(SRC).toMatch(/needsConfirm:\s*true/);
  });
  it('category system', () => {
    expect(SRC).toMatch(/category:\s*'system'/);
  });
  it('drafts via buildSkillFromRequest then createSkill', () => {
    expect(SRC).toMatch(/buildSkillFromRequest/);
    expect(SRC).toMatch(/createSkill/);
  });
  it('is registered in ALL_TOOLS', () => {
    expect(IDX).toMatch(/createSkillTool/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/tools/create-skill.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement create-skill.ts**

Create `packages/server/src/tools/create-skill.ts`:
```ts
/**
 * v2.0 Phase B4 — explicit skill creation tool. The agent calls it when
 * the user says "сделай навык …". needsConfirm:true — the drafted skill
 * is shown for confirmation before it is saved.
 */

import { z } from 'zod';
import type { Tool } from './_types.js';
import { buildSkillFromRequest, getHermesStore } from '../services/hermes/index.js';

const schema = z.object({
  request: z.string().min(1).describe('Что должен делать навык, словами пользователя'),
});

export const createSkillTool: Tool<z.infer<typeof schema>, string> = {
  name: 'create_skill',
  description:
    'Создать новый навык (сохранённый рецепт из существующих инструментов) ' +
    'по запросу пользователя. Используй, когда пользователь просит ' +
    '«сделай навык», «запомни это как навык».',
  category: 'system',
  schema,
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['сделай навык утренний брифинг', 'запомни это как навык'],
  handler: async (input, ctx): Promise<string> => {
    const spec = await buildSkillFromRequest(ctx.userId, input.request);
    if (!spec) {
      return 'Не получилось собрать навык из запроса. Уточни, что он должен делать.';
    }
    try {
      const saved = await getHermesStore().createSkill(ctx.userId, spec, 'explicit');
      const steps = (spec.plan ?? []).map((s) => s.toolName).join(' → ');
      return `Готово — создал навык «${saved.name}»: ${steps}. ` +
        `Запусти словами: ${(spec.triggers[0] ?? saved.name)}.`;
    } catch (err) {
      return `Навык не прошёл проверку безопасности: ` +
        `${err instanceof Error ? err.message : 'неизвестная ошибка'}.`;
    }
  },
};
```

- [ ] **Step 4: Register in ALL_TOOLS**

In `src/tools/index.ts`: add the import near the other tool imports:
```ts
import { createSkillTool } from './create-skill.js';
```
and add `createSkillTool,` to the `ALL_TOOLS` array (place it with system tools, e.g. after `applyInsightTool,`).

- [ ] **Step 5: Run test + tsc + registry-consistency test**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
npx vitest run src/tools/create-skill.test.ts src/tools/registry-consistency.test.ts src/tools/schema-anthropic-compat.test.ts
npx tsc --noEmit
```
Expected: all PASS; tsc clean. (The registry/schema tests guard that the new tool's zod schema is Anthropic-compatible and uniquely named.)

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/tools/create-skill.ts src/tools/create-skill.test.ts src/tools/index.ts
git commit -F - <<'EOF'
feat(v2-b4): create_skill tool + register (C1)

Explicit-creation tool (needsConfirm:true, category system). Drafts via
buildSkillFromRequest, persists via createSkill (validate-on-create gate).
Wired into ALL_TOOLS.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task C2: isV2HermesEnabled flag + orchestrator run-seed wiring

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/services/jarvis-orchestrator.ts`
- Test: `packages/server/src/services/hermes/wiring.test.ts`

- [ ] **Step 1: Write the failing test (structural + flag unit)**

Create `packages/server/src/services/hermes/wiring.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isV2HermesEnabled } from '../../lib/feature-flags.js';

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('isV2HermesEnabled', () => {
  afterEach(() => { delete process.env.FEATURE_V2_HERMES; });
  it('disabled when unset', () => {
    delete process.env.FEATURE_V2_HERMES;
    expect(isV2HermesEnabled('u1')).toBe(false);
  });
  it('all → enabled', () => {
    process.env.FEATURE_V2_HERMES = 'all';
    expect(isV2HermesEnabled('u1')).toBe(true);
  });
  it('comma list matches user- prefix', () => {
    process.env.FEATURE_V2_HERMES = 'user-u1,user-u2';
    expect(isV2HermesEnabled('u1')).toBe(true);
    expect(isV2HermesEnabled('u3')).toBe(false);
  });
});

describe('orchestrator hermes run-seed', () => {
  it('is gated by isV2HermesEnabled', () => {
    expect(ORCH).toMatch(/isV2HermesEnabled/);
  });
  it('routes to a skill and seeds the system prompt', () => {
    expect(ORCH).toMatch(/routeToSkill/);
    expect(ORCH).toMatch(/buildSkillInstruction/);
    expect(ORCH).toMatch(/bumpUsage/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/wiring.test.ts`
Expected: FAIL — flag missing + no wiring.

- [ ] **Step 3: Add the feature flag**

In `src/lib/feature-flags.ts`, append after `isV2FeedbackEnabled`:
```ts
/**
 * v2 Phase B4 — Per-user gate for Hermes composable skills.
 * Same shape as isV2AxesEnabled: "all"/"true", "none"/"false"/unset,
 * or comma list "user-X,user-Y".
 */
export function isV2HermesEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_HERMES;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Add imports + seed block in the orchestrator**

In `src/services/jarvis-orchestrator.ts`:
- Add imports near the other service imports (top of file):
```ts
import { routeToSkill, buildSkillInstruction, getHermesStore } from './hermes/index.js';
import { isV2HermesEnabled } from '../lib/feature-flags.js';
```
(If `feature-flags` is already imported with named flags, ADD `isV2HermesEnabled` to that existing import line instead of duplicating.)

- Locate the block (around lines 848-859) that appends the v2 enrichment to `system` right before `let reply: string;`:
```ts
  }

  let reply: string;
  try {
    reply = await runAgent({
      system,
      userMessage: text,
      history,
      webSearch: true,
      maxSearches: 3,
      maxTokens: 900,
      localTools: mayNeedLocalTools(text),
      userId,
    });
```
Insert a Hermes seed block immediately BEFORE `let reply: string;`, and force `localTools: true` when a skill is routed by using a mutable flag:
```ts
  }

  // v2 Phase B4 — Hermes: if the message routes to a saved skill, seed the
  // agent turn with the skill's plan. The existing loop executes it, so
  // money/write steps still hit their normal confirm gates. Best-effort.
  let hermesForceTools = false;
  if (isV2HermesEnabled(userId)) {
    try {
      const skills = await getHermesStore().activeSkills(userId);
      const matched = await routeToSkill(userId, text, skills);
      if (matched) {
        const spec = {
          name: matched.name,
          description: matched.description,
          triggers: matched.triggers,
          plan: matched.plan as unknown as { toolName: string }[],
          synthesis: matched.synthesis,
        };
        system = system + '\n\n' + buildSkillInstruction(spec as any);
        hermesForceTools = true;
        void getHermesStore().bumpUsage(matched.id);
      }
    } catch (err) {
      console.warn('[hermes:run-seed] failed:', err);
    }
  }

  let reply: string;
  try {
    reply = await runAgent({
      system,
      userMessage: text,
      history,
      webSearch: true,
      maxSearches: 3,
      maxTokens: 900,
      localTools: hermesForceTools || mayNeedLocalTools(text),
      userId,
    });
```
(Only the `localTools:` line changes inside the existing `runAgent` call — from `mayNeedLocalTools(text)` to `hermesForceTools || mayNeedLocalTools(text)`. Leave the rest of the call intact.)

- [ ] **Step 5: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/wiring.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/lib/feature-flags.ts src/services/jarvis-orchestrator.ts \
  src/services/hermes/wiring.test.ts
git commit -F - <<'EOF'
feat(v2-b4): isV2HermesEnabled flag + orchestrator run-seed (C2)

Gated. If the message routes to a saved skill, append buildSkillInstruction
to the system prompt and force localTools on; the existing agent loop runs
it with existing confirm gates. Best-effort — never blocks a normal turn.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task D1: detectSkillOpportunity proactivity detector

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts`
- Test: `packages/server/src/services/hermes/detector.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/detector.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENG = readFileSync(
  join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('skill_suggestion detector', () => {
  it('adds skill_suggestion to NudgeSource', () => {
    expect(ENG).toMatch(/skill_suggestion/);
  });
  it('has a detectSkillOpportunity over ToolCall history', () => {
    expect(ENG).toMatch(/detectSkillOpportunity/);
    expect(ENG).toMatch(/toolCall\.findMany|toolCall\.groupBy/);
  });
  it('has a TEMPLATES entry for skill_suggestion', () => {
    // TEMPLATES is Record<NudgeSource, ...> — must include the new key
    expect(ENG).toMatch(/skill_suggestion:\s*\{/);
  });
  it('scoreSignificance handles skill_suggestion', () => {
    expect(ENG).toMatch(/case 'skill_suggestion'/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend NudgeSource + TEMPLATES + scoreSignificance**

In `src/services/v2-proactivity-engine.ts`:
- Add `'skill_suggestion'` to the `NudgeSource` union (line ~19):
```ts
export type NudgeSource =
  | 'stale_entity'
  | 'commitment_due'
  | 'mood_shift'
  | 'streak_break'
  | 'goal_no_progress'
  | 'identity_growth'
  | 'skill_suggestion';
```
(Keep the existing members exactly; just append `| 'skill_suggestion'`. If `identity_growth` is absent in this file's union, still append `skill_suggestion` — do not remove any existing member.)
- Add a `TEMPLATES` entry (inside the `TEMPLATES` object):
```ts
  skill_suggestion: {
    curious: 'Заметил, что ты часто просишь одно и то же подряд. Хочешь, соберу это в навык — будешь запускать одной фразой?',
    gentle: 'Могу сделать тебе навык из того, что ты часто делаешь вместе. Сэкономит время. Сделать?',
  },
```
- Add a `scoreSignificance` case (inside the switch):
```ts
    case 'skill_suggestion': {
      const recurrence = Number(c.payload.recurrence ?? 0);
      const size = Number(c.payload.clusterSize ?? 0);
      return Math.min(1, (recurrence / 10) * (size / 4));
    }
```

- [ ] **Step 4: Add the detector + wire into detectCandidates**

Add the detector function near the other `detect*` helpers in the same file:
```ts
/**
 * v2 Phase B4 — propose a skill when the user repeatedly invokes the same
 * cluster of tools. Reads ToolCall history: groups same-day tool sets,
 * finds a cluster of >=3 distinct tools that recurs on >=3 distinct days.
 * Returns at most one candidate. Best-effort.
 */
export async function detectSkillOpportunity(
  userId: string,
): Promise<NudgeCandidate[]> {
  try {
    const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const calls = await prisma.toolCall.findMany({
      where: { userId, createdAt: { gte: since }, error: null },
      select: { toolName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    if (calls.length < 9) return [];
    // Group tool names by UTC day.
    const byDay = new Map<string, Set<string>>();
    for (const c of calls) {
      const day = c.createdAt.toISOString().slice(0, 10);
      const set = byDay.get(day) ?? new Set<string>();
      set.add(c.toolName);
      byDay.set(day, set);
    }
    // Count per-tool day-frequency; cluster = tools present on >=3 days.
    const dayCount = new Map<string, number>();
    for (const set of byDay.values()) {
      for (const t of set) dayCount.set(t, (dayCount.get(t) ?? 0) + 1);
    }
    const cluster = [...dayCount.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t);
    if (cluster.length < 3) return [];
    const recurrence = Math.max(...cluster.map((t) => dayCount.get(t) ?? 0));
    return [{
      source: 'skill_suggestion',
      significance: 0,
      payload: { cluster, clusterSize: cluster.length, recurrence },
      toneHint: 'curious',
    }];
  } catch (err) {
    console.warn('[v2-proactivity:skill] failed:', err);
    return [];
  }
}
```
Then in the `detectCandidates` method body, add the new detector to the gathered results (mirror how the existing detectors are collected — find where results from `detectStaleEntity`/etc. are concatenated and add `...(await detectSkillOpportunity(userId))` or the file's established pattern, e.g. push into the candidates array). Keep the existing detectors intact.

- [ ] **Step 5: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/detector.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (If `scoreSignificance` is exhaustively typed over NudgeSource, adding the union member without the case would fail tsc — the case added in Step 3 covers it.)

- [ ] **Step 6: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/v2-proactivity-engine.ts src/services/hermes/detector.test.ts
git commit -F - <<'EOF'
feat(v2-b4): detectSkillOpportunity proactivity detector (D1)

New skill_suggestion NudgeSource + TEMPLATES + scoreSignificance case.
Detector groups ToolCall history by day, finds a >=3-tool cluster
recurring on >=3 days, proposes a skill via KAIROS-gated nudge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task D2: /skills Telegram command

**Files:**
- Modify: `packages/server/src/services/telegram-bot.ts`
- Test: `packages/server/src/services/hermes/telegram.test.ts`

- [ ] **Step 1: Write the failing test (structural)**

Create `packages/server/src/services/hermes/telegram.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT = readFileSync(
  join(process.cwd(), 'src/services/telegram-bot.ts'), 'utf-8');

describe('/skills command', () => {
  it('registers the skills command', () => {
    expect(BOT).toMatch(/bot\.command\('skills'/);
  });
  it('lists / deletes via the hermes store', () => {
    expect(BOT).toMatch(/getHermesStore/);
    expect(BOT).toMatch(/listSkills/);
    expect(BOT).toMatch(/deleteSkill/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/telegram.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the import + command**

In `src/services/telegram-bot.ts`:
- Add near the other service imports (e.g. by the `getFeedbackStore` import from B3):
```ts
import { getHermesStore } from './hermes/index.js';
```
- Register the command near the other `bot.command(...)` blocks (after the `identity` command, ~line 251). It uses the SAME `findOrCreateUser(chatId, from.id, from.first_name || '', from.username)` resolver that the `/axes` command uses a few lines above in this same file (already imported). Concretely:
```ts
  // v2 Phase B4 — Hermes skills management
  bot.command('skills', async (ctx) => {
    if (!ctx.message) return;
    try {
      const chatId = String(ctx.chat?.id);
      const from = ctx.from;
      if (!chatId || !from) return;
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      const parts = (ctx.message.text ?? '').split(' ').slice(1);
      const sub = (parts[0] ?? 'list').toLowerCase();
      const arg = parts.slice(1).join(' ').trim();
      const store = getHermesStore();

      if (sub === 'delete' && arg) {
        const ok = await store.deleteSkill(userId, arg);
        await ctx.reply(ok ? `Удалил навык «${arg}».` : `Навык «${arg}» не найден.`);
        return;
      }

      const skills = await store.listSkills(userId);
      if (skills.length === 0) {
        await ctx.reply('У тебя пока нет навыков. Скажи «сделай навык …» — и я соберу.');
        return;
      }
      const lines = ['🛠 Твои навыки:', ''];
      for (const s of skills) {
        const used = s.useCount > 0 ? ` · запусков: ${s.useCount}` : '';
        lines.push(`• ${s.name} — ${s.description}${used}`);
      }
      lines.push('', 'Запустить: напиши название навыка. Удалить: /skills delete <название>.');
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      console.warn('[telegram:skills] failed:', err);
      await ctx.reply('Не получилось показать навыки. Попробуй позже.');
    }
  });
```
NOTE: use the SAME userId resolver the `/axes` command uses in this file (find how `bot.command('axes', ...)` obtains `userId` and copy that exact mechanism — the placeholder `resolveUserIdFromCtx` above must be replaced with the real resolver call used a few lines above in the same file). Do not invent a new resolver.

- [ ] **Step 4: Run test + tsc**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/hermes/telegram.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/services/telegram-bot.ts src/services/hermes/telegram.test.ts
git commit -F - <<'EOF'
feat(v2-b4): /skills telegram command (D2)

List skills (name + description + use count), /skills delete <name>.
Run-by-name is handled by the orchestrator router. Best-effort.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task E1: integration test + full verify + progress tracker

**Files:**
- Create: `packages/server/src/__integration__/v2-hermes-flow.test.ts`
- Modify: `docs/plan/v2-memory-proactivity-scope.md`

- [ ] **Step 1: Write the integration test (structural)**

Create `packages/server/src/__integration__/v2-hermes-flow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCH = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');
const RUNNER = readFileSync(join(process.cwd(), 'src/services/hermes/types.ts'), 'utf-8');
const IMPL = readFileSync(join(process.cwd(), 'src/services/hermes/postgres-impl.ts'), 'utf-8');
const TOOL = readFileSync(join(process.cwd(), 'src/tools/create-skill.ts'), 'utf-8');

describe('v2 hermes flow — run via existing agent loop', () => {
  it('orchestrator seeds the skill instruction, gated by the flag', () => {
    expect(ORCH).toContain('isV2HermesEnabled');
    expect(ORCH).toContain('routeToSkill');
    expect(ORCH).toContain('buildSkillInstruction');
  });
  it('skill execution is seed-only — no direct tool handler dispatch in hermes', () => {
    // buildSkillInstruction returns a string; hermes must NOT import the
    // tool registry to call handlers itself (execution belongs to the loop).
    expect(RUNNER).not.toMatch(/\.handler\(/);
  });
});

describe('v2 hermes flow — safety', () => {
  it('createSkill validates against the live registry + blocklist', () => {
    expect(IMPL).toMatch(/validateSkillTools/);
  });
  it('explicit creation tool needs confirmation', () => {
    expect(TOOL).toMatch(/needsConfirm:\s*true/);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/__integration__/v2-hermes-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run:
```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run 2>&1 | tail -20
```
Expected: tsc clean; all tests pass (baseline 1670 + B4 additions ~55–65). `[...] failed:` / Prisma FK lines in stderr are intentional best-effort logs, not failures — only the final "Test Files / Tests passed" summary matters. If any test genuinely FAILS, STOP and report.

- [ ] **Step 4: Update progress tracker**

In `docs/plan/v2-memory-proactivity-scope.md`, add a B4 "done" entry mirroring the B1/B2/B3 entries: passive composable skills shipped; data-not-code; runs via existing agent loop (money/write inherit confirm gates); pet+photo blocklist; both creation paths (create_skill tool + detectSkillOpportunity); skill-router (exact + Voyage); `/skills` command; flag `isV2HermesEnabled`; files under `src/services/hermes/` + `src/tools/create-skill.ts`. Match the document's existing heading/format.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server
git add src/__integration__/v2-hermes-flow.test.ts \
  /Users/berikkurmangoliev/Desktop/LifeOS/docs/plan/v2-memory-proactivity-scope.md
git commit -F - <<'EOF'
test(v2-b4): hermes-flow integration + progress tracker (E1)

Structural integration: orchestrator seeds skill instruction (flag-gated);
hermes never calls tool handlers directly (execution stays in the agent
loop); createSkill validates against registry+blocklist; create_skill
needs confirmation. Marks B4 done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Rollout (AFTER all tasks green — explicit Berik approval per step)
1. **Push** (on "push"): `git push origin main`.
2. **Deploy**: Railway `migrate deploy` auto-creates `SkillDefinition`. Verify table in prod (`to_regclass('public."SkillDefinition"')`).
3. **Flag**: `FEATURE_V2_HERMES=user-cmp6n0jf90000pf017gv1kukz` (Berik Telegram id — DUAL ACCOUNT, not email id).
4. **SMOKE** (Telegram): "сделай навык: утром давай задачи и бюджет" → confirm → say the trigger ("утренний брифинг") → skill runs through the agent loop; `/skills` lists it; a money step (if any) still asks confirmation.

---

## Self-Review (against the spec)
**Spec coverage:**
- §1 data-not-code → B1 types (no eval); E1 asserts no `.handler(` in hermes ✓
- §2 composed + both creation paths → C1 (explicit) + D1 (proactive) ✓
- §2 all tools except pet/photo → B1 BLOCKLIST + B4 validate-on-create ✓
- §3 seeded-instruction execution via agent loop → B1 buildSkillInstruction + C2 wiring ✓
- §4 safety (blocklist create+run, inherited gates, no recursion, cap, per-user, flag) → B1/B4/C1/C2 ✓
- §5 standard migration folder → A1 ✓
- §6 components (types/builder/router/postgres/index) → B1–B5 ✓
- §7 wiring (create_skill, detector, orchestrator, /skills) → C1/C2/D1/D2 ✓
- §9 testing (pure unit + structural + integration, zero vi.mock) → all ✓

**Placeholder scan:** the ONLY intentional "replace this" is in D2 Step 3 (`resolveUserIdFromCtx` → the real resolver used by `/axes` in the same file) — flagged explicitly with instructions, not a silent placeholder. The implementer must mirror the existing `/axes` resolver.

**Type consistency:** `SkillSpec`/`SkillStep` defined B1, reused B2/B4/C1. `validateSkillTools(plan, knownToolNames, categoryOf)` signature consistent B1→B4. `HermesStore` methods (`createSkill/listSkills/activeSkills/getSkill/deleteSkill/bumpUsage`) consistent B4→C1/C2/D2. `routeToSkill(userId, text, activeSkills)` consistent B3→C2. `NudgeSource += 'skill_suggestion'` with matching `scoreSignificance` case + `TEMPLATES` key (D1).

**Total:** 12 tasks (A1, B1–B5, C1–C2, D1–D2, E1). Mirrors B1/B2/B3 granularity.
```
