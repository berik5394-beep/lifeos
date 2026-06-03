# Goal Effort Estimate (Weekly) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Дать `WeeklyGoal` числовую ИИ-оценку усилия в минутах/неделю (`estimatedMinutes Int?`), заполняемую haiku фоном — data-слой для будущего `month-load.ts`.

**Architecture:** Изолированный модуль `services/estimate-goal-minutes.ts` (зеркало `estimate-task-minutes.ts` + idempotent-writer из `day-load.ts`). Гейт новым флагом `FEATURE_V2_MONTH_LOAD`. Хуки fire-and-forget в REST `/goals/weekly` и в планировщике `persistPlan` (реальный путь через голос/чат). Деньги/день/неделя/задачи-эстиматор не трогаем.

**Tech Stack:** packages/server, Fastify+Prisma, strict TS, ESM NodeNext ('.js'), vitest zero vi.mock, структурные тесты readFileSync+grep.

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit. Команды из `packages/server`. Коммит heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. База сюиты **2139** зелёная. Флаг off = байт-в-байт. Прод-миграция руками; локально только `npx prisma generate` (НИКОГДА `db push`/`migrate dev` против прод-.env).

---

## Task 1: Prisma `WeeklyGoal.estimatedMinutes` + миграция

**Files:**
- Modify: `packages/server/prisma/schema.prisma` (model WeeklyGoal, ~279–302)
- Create: `packages/server/prisma/migrations/20260603120000_weekly_goal_estimated_minutes/migration.sql`

- [ ] **Step 1: Schema** — в model `WeeklyGoal` добавить поле сразу после `order Int @default(0)` (или рядом с прочими скалярами):

```prisma
  estimatedMinutes Int?
```

- [ ] **Step 2: Migration SQL** — создать файл `packages/server/prisma/migrations/20260603120000_weekly_goal_estimated_minutes/migration.sql`:

```sql
-- ИИ-оценка усилия недельной цели (минуты/неделя). Nullable, additive,
-- идемпотентно. Питает month-load (срез МЕСЯЦ движка пересечения).
ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER;
```

- [ ] **Step 3: Generate client** — обновить типы Prisma (БЕЗ записи в БД):

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx prisma generate`
Expected: `Generated Prisma Client` без ошибок.

- [ ] **Step 4: tsc** — убедиться, что новое поле типизировано:

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit`
Expected: 0 ошибок.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/20260603120000_weekly_goal_estimated_minutes/migration.sql && git commit -F - <<'EOF'
feat(goals): WeeklyGoal.estimatedMinutes Int? + additive migration

Nullable column for AI weekly-effort estimate (minutes/week). Feeds the
future month-load slice. db push-safe (nullable, no default).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Флаг `isV2MonthLoadEnabled` (`FEATURE_V2_MONTH_LOAD`)

**Files:**
- Modify: `packages/server/src/lib/feature-flags.ts`
- Modify: `packages/server/src/lib/feature-flags.test.ts`

- [ ] **Step 1: Failing test** — в `feature-flags.test.ts` добавить `isV2MonthLoadEnabled` к импорту из `'./feature-flags.js'` (рядом с `isV2WeekLoadEnabled`) и describe-блок перед `describe('isV2WeekLoadEnabled'`:

```ts
describe('isV2MonthLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_MONTH_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_MONTH_LOAD;
    else process.env.FEATURE_V2_MONTH_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_MONTH_LOAD;
    expect(isV2MonthLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_MONTH_LOAD = 'all';
    expect(isV2MonthLoadEnabled('u1')).toBe(true);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/lib/feature-flags.test.ts` → FAIL (нет экспорта).

- [ ] **Step 3: Impl** — в `feature-flags.ts` после `isV2WeekLoadEnabled`:

```ts
/** Движок пересечения, срез 3 (месяц). Гейтит и data-слой (оценка целей),
 *  и будущий month-load нудж. Off → байт-в-байт. */
export function isV2MonthLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MONTH_LOAD, userId);
}
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/lib/feature-flags.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -F - <<'EOF'
feat(engine): isV2MonthLoadEnabled flag (FEATURE_V2_MONTH_LOAD)

One flag for the whole MONTH slice — gates the goal-estimate data layer now
and the month-load nudge next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `estimate-goal-minutes.ts` — эстиматор недельной цели

**Files:**
- Create: `packages/server/src/services/estimate-goal-minutes.ts`
- Create: `packages/server/src/services/estimate-goal-minutes.test.ts`

- [ ] **Step 1: Failing test** — создать `estimate-goal-minutes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoalMinutes } from './estimate-goal-minutes.js';

describe('parseGoalMinutes — чистый парсер минут/нед', () => {
  it('число в диапазоне → как есть', () => {
    expect(parseGoalMinutes('120')).toBe(120);
    expect(parseGoalMinutes('примерно 300 минут')).toBe(300);
  });
  it('0 → 0 (цель не про время, напр. деньги)', () => {
    expect(parseGoalMinutes('0')).toBe(0);
  });
  it('ниже MIN (15) → кламп', () => {
    expect(parseGoalMinutes('5')).toBe(15);
  });
  it('выше MAX (1200) → кламп', () => {
    expect(parseGoalMinutes('9999')).toBe(1200);
  });
  it('нет числа / мусор → DEFAULT (120)', () => {
    expect(parseGoalMinutes('не знаю')).toBe(120);
    expect(parseGoalMinutes('')).toBe(120);
  });
});

describe('estimate-goal-minutes — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/estimate-goal-minutes.ts'), 'utf-8');
  it('haiku через createAnthropic + MODELS.haiku', () => {
    expect(SRC).toContain('createAnthropic');
    expect(SRC).toContain('MODELS.haiku');
  });
  it('фоновый писатель: гейт флагом + идемпотентный updateMany', () => {
    expect(SRC).toContain('isV2MonthLoadEnabled');
    expect(SRC).toMatch(/weeklyGoal\.updateMany/);
    expect(SRC).toMatch(/estimatedMinutes: null/);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/estimate-goal-minutes.test.ts` → FAIL (модуля нет).

- [ ] **Step 3: Impl** — создать `estimate-goal-minutes.ts`:

```ts
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { prisma } from '../lib/prisma.js';
import { isV2MonthLoadEnabled } from '../lib/feature-flags.js';

export const DEFAULT_GOAL_MINUTES = 120; // 2 ч/нед
const MIN_GOAL_MINUTES = 15;
const MAX_GOAL_MINUTES = 1200; // 20 ч/нед

/**
 * Минуты усилия/нед из ответа модели. Чистая.
 * `0` → 0 (цель не про время, напр. накопить денег). Иначе кламп
 * [15, 1200]. Нет числа → DEFAULT.
 */
export function parseGoalMinutes(text: string): number {
  const m = text.match(/\d+/);
  if (!m) return DEFAULT_GOAL_MINUTES;
  const n = Number(m[0]);
  if (n === 0) return 0;
  return Math.min(MAX_GOAL_MINUTES, Math.max(MIN_GOAL_MINUTES, Math.round(n)));
}

/**
 * Оценка усилия недельной цели (минуты/нед). Best-effort haiku;
 * на любой сбой → DEFAULT_GOAL_MINUTES. Без БД.
 */
export async function estimateWeeklyGoalMinutes(goalText: string): Promise<number> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return DEFAULT_GOAL_MINUTES;
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 16,
      system:
        'Оцени, сколько МИНУТ усилия в НЕДЕЛЮ среднему человеку нужно ' +
        'на эту недельную цель. Если цель не про затраты времени ' +
        '(например, накопить денег) — верни 0. ' +
        'Верни ТОЛЬКО целое число минут, без слов.',
      messages: [{ role: 'user', content: `Недельная цель: «${goalText}»` }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? parseGoalMinutes(block.text) : DEFAULT_GOAL_MINUTES;
  } catch {
    return DEFAULT_GOAL_MINUTES;
  }
}

/**
 * Фоновая оценка недельной цели (только если ещё не задана). Гейт флагом
 * FEATURE_V2_MONTH_LOAD. Fire-and-forget — не блокирует создание цели.
 */
export async function estimateWeeklyGoalMinutesInBackground(
  goalId: string,
  goalText: string,
  userId: string,
): Promise<void> {
  if (!isV2MonthLoadEnabled(userId)) return;
  try {
    const minutes = await estimateWeeklyGoalMinutes(goalText);
    await prisma.weeklyGoal.updateMany({
      where: { id: goalId, estimatedMinutes: null },
      data: { estimatedMinutes: minutes },
    });
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/services/estimate-goal-minutes.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/estimate-goal-minutes.ts packages/server/src/services/estimate-goal-minutes.test.ts && git commit -F - <<'EOF'
feat(goals): estimate-goal-minutes — haiku weekly-effort estimator

parseGoalMinutes (0→0 for money goals, clamp 15–1200, default 120),
estimateWeeklyGoalMinutes (haiku best-effort), and a flag-gated idempotent
background writer (updateMany where estimatedMinutes:null). Mirrors the task
estimator; isolated module.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Хук REST `/goals/weekly`

**Files:**
- Modify: `packages/server/src/routes/goals.ts` (POST /goals/weekly, ~63–89)
- Create: `packages/server/src/routes/goals-estimate.test.ts`

- [ ] **Step 1: Failing test** — создать `goals-estimate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/routes/goals.ts'), 'utf-8');

describe('routes/goals — хук оценки недельной цели', () => {
  it('POST /goals/weekly запускает фоновую оценку', () => {
    expect(SRC).toContain('estimateWeeklyGoalMinutesInBackground');
    expect(SRC).toMatch(/void estimateWeeklyGoalMinutesInBackground\(/);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/routes/goals-estimate.test.ts` → FAIL.

- [ ] **Step 3a: Impl import** — в `routes/goals.ts` добавить импорт (рядом с прочими import-строками вверху файла):

```ts
import { estimateWeeklyGoalMinutesInBackground } from '../services/estimate-goal-minutes.js';
```

- [ ] **Step 3b: Impl hook** — в POST `/goals/weekly` заменить блок (строки ~84–88):

```ts
    captureActivity(request.userId, {
      type: 'weekly_goal_created',
      content: `Цель недели «${goal.goalText}» (${data.weekStart})`,
    });
    return reply.status(201).send(goal);
```

на:

```ts
    captureActivity(request.userId, {
      type: 'weekly_goal_created',
      content: `Цель недели «${goal.goalText}» (${data.weekStart})`,
    });
    // #engine: оценка усилия/нед фоном (под флагом month-load).
    void estimateWeeklyGoalMinutesInBackground(goal.id, goal.goalText, request.userId);
    return reply.status(201).send(goal);
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/routes/goals-estimate.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/routes/goals.ts packages/server/src/routes/goals-estimate.test.ts && git commit -F - <<'EOF'
feat(goals): estimate weekly-goal effort on POST /goals/weekly

Fire-and-forget background estimate after create (flag-gated). REST path
(mobile later); never blocks the response.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Хук планировщик `persistPlan`

**Files:**
- Modify: `packages/server/src/services/planner-service.ts` (persistPlan, ~523–604)
- Create: `packages/server/src/services/planner-estimate.test.ts`

**Контекст (прочитай перед правкой):** `persistPlan` создаёт недельные цели в `$transaction` циклом `tx.weeklyGoal.create(...)` (строки ~554–567), но НЕ собирает созданные строки. Нужно собрать `{id, goalText}` внутри цикла и запустить фоновые оценки ПОСЛЕ коммита транзакции (фоновый `updateMany` не должен гонять открытую транзакцию).

- [ ] **Step 1: Failing test** — создать `planner-estimate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/planner-service.ts'), 'utf-8');

describe('planner-service — оценка недельных целей после persistPlan', () => {
  it('собирает созданные строки и запускает фоновую оценку после транзакции', () => {
    expect(SRC).toContain('estimateWeeklyGoalMinutesInBackground');
    expect(SRC).toContain('createdWeeklyGoals');
    expect(SRC).toMatch(/void estimateWeeklyGoalMinutesInBackground\(/);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/planner-estimate.test.ts` → FAIL.

- [ ] **Step 3a: Impl import** — в `planner-service.ts` добавить импорт (рядом с прочими import-строками вверху файла):

```ts
import { estimateWeeklyGoalMinutesInBackground } from './estimate-goal-minutes.js';
```

- [ ] **Step 3b: Impl — объявить аккумулятор** — найти строки (перед `await prisma.$transaction(async (tx) => {`, ~529–531):

```ts
  let created = 0;
  let archived = 0;
  await prisma.$transaction(async (tx) => {
```

заменить на:

```ts
  let created = 0;
  let archived = 0;
  const createdWeeklyGoals: Array<{ id: string; goalText: string }> = [];
  await prisma.$transaction(async (tx) => {
```

- [ ] **Step 3c: Impl — собрать строки в цикле** — найти блок (строки ~554–567):

```ts
    for (const w of rows.weeklyGoals) {
      await tx.weeklyGoal.create({
        data: {
          userId,
          weekStart: w.weekStart,
          goalText: w.goalText,
          order: w.order,
          planParentId: w.planParentId,
          planParentType: w.planParentType,
          derivedFrom: w.derivedFrom,
        },
      });
      created++;
    }
```

заменить на:

```ts
    for (const w of rows.weeklyGoals) {
      const wg = await tx.weeklyGoal.create({
        data: {
          userId,
          weekStart: w.weekStart,
          goalText: w.goalText,
          order: w.order,
          planParentId: w.planParentId,
          planParentType: w.planParentType,
          derivedFrom: w.derivedFrom,
        },
      });
      createdWeeklyGoals.push({ id: wg.id, goalText: wg.goalText });
      created++;
    }
```

- [ ] **Step 3d: Impl — запустить оценки после транзакции** — найти конец транзакции и начало `habitNote` (строки ~603–605):

```ts
  });

  const habitNote = rows.habit
```

заменить на:

```ts
  });

  // #engine: оценка усилия/нед фоном для созданных целей (под флагом
  // month-load). После коммита транзакции — не гоняем открытую tx.
  for (const wg of createdWeeklyGoals) {
    void estimateWeeklyGoalMinutesInBackground(wg.id, wg.goalText, userId);
  }

  const habitNote = rows.habit
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/services/planner-estimate.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/planner-service.ts packages/server/src/services/planner-estimate.test.ts && git commit -F - <<'EOF'
feat(goals): estimate weekly-goal effort after planner persistPlan

Collect created weekly-goal rows in the tx, then fire background estimates
after commit (flag-gated). The real voice/chat path that populates estimates
for the month-load slice.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Финальная сверка + независимое ревью

- [ ] **Step 1: Full suite + tsc** — `cd packages/server && npx vitest run && npx tsc --noEmit` → все зелёные (2139 + новые), 0.

- [ ] **Step 2: Изоляция** — деньги/день/неделя/задачи-эстиматор не изменены:

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS && git diff --name-only 26e382c..HEAD -- packages/server/src | grep -E "estimate-task-minutes|day-load|week-load|savings" || echo "(none touched — ок)"`
Expected: `(none touched — ок)`.

- [ ] **Step 3: Независимое ревью** (`superpowers:code-reviewer`) на диффе. Инварианты:
  - Флаг off (`FEATURE_V2_MONTH_LOAD` unset) → оценка не зовётся, `estimatedMinutes` остаётся null, REST/планировщик байт-в-байт.
  - Best-effort: фоновый писатель никогда не валит создание цели (try/catch проглатывает; `void` fire-and-forget).
  - Идемпотентность: `updateMany({where:{id, estimatedMinutes:null}})` — не перезатирает.
  - Планировщик: оценки запускаются ПОСЛЕ коммита `$transaction` (нет гонки с открытой tx); собранные id из реально созданных строк.
  - `parseGoalMinutes`: `0`→0, кламп [15,1200], мусор→120; без NaN.
  - Миграция additive nullable (db push-safe).
  - Деньги/день/неделя/задачи не тронуты.

- [ ] **Step 4:** Память (observation + interconnection_map/roadmap «месяц: data-слой done, нудж next») + предложить деплой (флаг `FEATURE_V2_MONTH_LOAD` через account-token+curl после явного слова Berik).

---

## Self-Review (автор)

**Spec coverage:** §3.1 схема+миграция→Task1; §3.2 эстиматор (parseGoalMinutes/estimateWeeklyGoalMinutes/InBackground)→Task3; §3.3 флаг→Task2; §3.4 хуки REST+планировщик→Task4/Task5; §6 тесты→в каждой задаче (parseGoalMinutes юнит, структурные гейт/haiku/updateMany/хуки, изоляция-grep Task6); §7 инварианты→Task6 ревью.

**Placeholders:** нет. Все code-блоки полные.

**Type consistency:** `estimateWeeklyGoalMinutesInBackground(goalId, goalText, userId)` — сигнатура едина в Task3 (определение), Task4 (`goal.id, goal.goalText, request.userId`), Task5 (`wg.id, wg.goalText, userId`). `parseGoalMinutes(text)` / `estimateWeeklyGoalMinutes(goalText)` — едины. Флаг `isV2MonthLoadEnabled` определён Task2, использован Task3. Поле `estimatedMinutes` — Task1 (schema) ↔ Task3 (updateMany). `createdWeeklyGoals: Array<{id,goalText}>` — объявлен Task5 Step3b, наполнен 3c, прочитан 3d.

**Migration:** базовая ревизия для изоляции-grep — `26e382c` (коммит спеки).
