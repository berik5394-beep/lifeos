# Month-plan (MonthlyGoal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать боту инструмент завести **цель на месяц** из чата, которая РЕАЛЬНО пишется в БД (`MonthlyGoal`) и сразу видна мозгу (промпт-врезка + `get_monthly_plan` tool + проактивный детектор конца месяца с роллапом месяц↔неделя).

**Architecture:** Точная калька зашипленной фичи `create_weekly_goal`/`WeeklyGoal`, отличия только в периоде (месяц вместо недели) и одном новом тайминге (конец месяца). SSOT-точка периода — `localMonthOnlyUTC(tz)` (UTC-полночь 1-го числа локального месяца, `@db.Date`-конвенция, уже есть в `lib/tz.ts:157`). Писатель и все 3 читателя смотрят в эту одну точку. Без флага (аддитивно), активируется на деплое вместе с миграцией.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM (`.js`-импорты), TS strict (no `any`), vitest (zero `vi.mock`, real prisma в `.it.test.ts`, структурные тесты `readFileSync`+grep).

**Baseline:** unit ~2467 + integration ~122 зелёные. `.env`=ПРОД → миграцию РУКАМИ (schema+SQL+generate), НЕ `migrate dev`. Commit-per-step с trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push/deploy — ТОЛЬКО по слову Berik.

---

## File Structure

| Файл | Ответственность | Действие |
|------|------------------|----------|
| `packages/server/src/lib/tz.ts` | `daysUntilMonthEnd` (чистый хелпер дней до конца месяца) | Modify |
| `packages/server/src/lib/tz.test.ts` | юнит `daysUntilMonthEnd` | Modify |
| `packages/server/prisma/schema.prisma` | модель `MonthlyGoal` + связь в `User` | Modify |
| `packages/server/prisma/migrations/20260607000000_monthly_goal/migration.sql` | DDL таблицы (идемпотентный) | Create |
| `packages/server/src/tools/create-monthly-goal.ts` | писатель `create_monthly_goal` | Create |
| `packages/server/src/tools/create-monthly-goal.it.test.ts` | it-тест писателя + кросс-домен ридер | Create |
| `packages/server/src/tools/get-monthly-plan.ts` | ридер `get_monthly_plan` | Create |
| `packages/server/src/tools/index.ts` | регистрация двух tool | Modify |
| `packages/server/src/services/assistant-service.ts` | врезка «План на месяц» (fetch + строка + context) | Modify |
| `packages/server/src/ai/jarvis-prompt.ts` | `monthlyPlan?` в типе + рендер в промпт | Modify |
| `packages/server/src/services/v2-proactivity-engine.ts` | `monthly_goal_stall` (union/score/TEMPLATES/candidate/detector/wiring) | Modify |
| `packages/server/src/services/v2-proactivity-engine.test.ts` | юнит `monthlyStallCandidate` + exhaustiveness | Modify |
| `packages/server/src/services/monthly-goal-wiring.test.ts` | структурный гард-тест | Create |

---

## Task 1: Чистый хелпер `daysUntilMonthEnd`

**Files:**
- Modify: `packages/server/src/lib/tz.ts` (рядом с `localMonthStartUTC`, ~:173)
- Test: `packages/server/src/lib/tz.test.ts`

- [ ] **Step 1: Write the failing test** — добавь в `tz.test.ts` (импорт `daysUntilMonthEnd` добавь в существующий импорт из `./tz.js`):

```typescript
describe('daysUntilMonthEnd — дней до конца месяца в tz юзера', () => {
  it('середина месяца (Almaty, 15 июня) → 15', () => {
    expect(daysUntilMonthEnd('Asia/Almaty', new Date('2026-06-15T10:00:00Z'))).toBe(15);
  });
  it('последний день месяца → 0', () => {
    expect(daysUntilMonthEnd('Asia/Almaty', new Date('2026-06-30T10:00:00Z'))).toBe(0);
  });
  it('первое число → daysInMonth-1 (июнь 30 → 29)', () => {
    expect(daysUntilMonthEnd('Asia/Almaty', new Date('2026-06-01T10:00:00Z'))).toBe(29);
  });
  it('tz-aware на границе месяца: 30 июня 20:00 UTC = 1 июля в Almaty → 30 (июль 31 дн)', () => {
    expect(daysUntilMonthEnd('Asia/Almaty', new Date('2026-06-30T20:00:00Z'))).toBe(30);
    // тот же инстант в UTC = ещё 30 июня → 0
    expect(daysUntilMonthEnd('UTC', new Date('2026-06-30T20:00:00Z'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/lib/tz.test.ts -t daysUntilMonthEnd`
Expected: FAIL — `daysUntilMonthEnd is not a function` / import error.

- [ ] **Step 3: Write minimal implementation** — добавь в `tz.ts` сразу ПОСЛЕ `localMonthStartUTC` (после строки ~173):

```typescript
/**
 * Сколько ЦЕЛЫХ дней осталось до конца КАЛЕНДАРНОГО месяца юзера (0 = сегодня
 * последний день месяца). В tz юзера, не сервера. Чисто/детерминированно
 * (день — из `at`). Для детектора «конец месяца, цель не закрыта».
 */
export function daysUntilMonthEnd(tz: string, at: Date = new Date()): number {
  const [y, m, d] = localDateStr(safeTz(tz), at).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(); // день 0 след. месяца = последний день текущего
  return daysInMonth - d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/lib/tz.test.ts -t daysUntilMonthEnd`
Expected: PASS (4 теста).

- [ ] **Step 5: tsc + commit**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/lib/tz.ts packages/server/src/lib/tz.test.ts
git commit -F - <<'EOF'
feat(month-plan): daysUntilMonthEnd — дней до конца месяца в tz юзера (T1)

Чистый хелпер для детектора конца месяца. tz-aware (граница месяца
30июн20:00Z=1июля Almaty). Юниты: середина/последний/первый день + tz-граница.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Модель `MonthlyGoal` + миграция

**Files:**
- Modify: `packages/server/prisma/schema.prisma` (рядом с `model WeeklyGoal`, :255; и `model User`, :10)
- Create: `packages/server/prisma/migrations/20260607000000_monthly_goal/migration.sql`

- [ ] **Step 1: Добавь модель в `schema.prisma`** — сразу после `model WeeklyGoal { ... }`:

```prisma
model MonthlyGoal {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  monthStart DateTime @db.Date // UTC-полночь 1-го числа локального месяца (localMonthOnlyUTC)
  goalText   String
  completed  Boolean  @default(false)
  order      Int      @default(0)
  createdAt  DateTime @default(now())

  @@index([userId, monthStart])
}
```

- [ ] **Step 2: Добавь обратную связь в `model User`** — в список связей (рядом с `weeklyGoals WeeklyGoal[]` если есть, иначе среди других `[]`-связей):

```prisma
  monthlyGoals   MonthlyGoal[]
```

- [ ] **Step 3: Создай миграцию** — `packages/server/prisma/migrations/20260607000000_monthly_goal/migration.sql`:

```sql
-- MonthlyGoal: «цель на месяц» из чата (зеркало WeeklyGoal). ИДЕМПОТЕНТНА:
-- CREATE TABLE/INDEX IF NOT EXISTS + FK через DO/pg_constraint → no-op на проде,
-- полная на чистой БД. .env=ПРОД, накатывает Railway migrate deploy на деплое.
CREATE TABLE IF NOT EXISTS "MonthlyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthStart" DATE NOT NULL,
    "goalText" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MonthlyGoal_userId_monthStart_idx" ON "MonthlyGoal"("userId", "monthStart");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MonthlyGoal_userId_fkey') THEN
  ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END IF; END $$;
```

- [ ] **Step 4: Сгенерируй Prisma client** (НЕ `migrate dev` — `.env`=ПРОД):

Run: `cd packages/server && npx prisma generate`
Expected: `Generated Prisma Client` — теперь `prisma.monthlyGoal` существует в типах.

- [ ] **Step 5: tsc проверка (типы модели подхватились)**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (0 ошибок).

- [ ] **Step 6: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/20260607000000_monthly_goal
git commit -F - <<'EOF'
feat(month-plan): модель MonthlyGoal + идемпотентная миграция (T2)

Зеркало WeeklyGoal: monthStart @db.Date (localMonthOnlyUTC), goalText,
completed, order. CREATE TABLE/INDEX IF NOT EXISTS + FK через DO → прод-безопасно,
применится на деплое (migrate deploy). prisma generate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Писатель `create_monthly_goal` + регистрация + it-тест

**Files:**
- Create: `packages/server/src/tools/create-monthly-goal.ts`
- Create: `packages/server/src/tools/create-monthly-goal.it.test.ts`
- Modify: `packages/server/src/tools/index.ts` (импорт :24 область + `ALL_TOOLS` :82 область)

- [ ] **Step 1: Write the failing it-test** — `create-monthly-goal.it.test.ts` (зеркало `create-weekly-goal.it.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createMonthlyGoalTool } from './create-monthly-goal.js';
import { getMonthlyPlanTool } from './get-monthly-plan.js';
import { localMonthOnlyUTC } from '../lib/tz.js';

/**
 * create_monthly_goal — РЕАЛЬНО пишет MonthlyGoal на 1-е число месяца юзера +
 * КРОСС-ДОМЕН: живой ридер get_monthly_plan (та же SSOT localMonthOnlyUTC)
 * сразу видит цель. Real prisma, zero vi.mock.
 */
const prisma = new PrismaClient();

function mkUser(email: string, timezone = 'Asia/Almaty') {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x', timezone } });
}
async function create(userId: string, goalText: string) {
  return (await createMonthlyGoalTool.handler({ goalText } as never, { userId } as never)) as {
    message: string;
    monthlyGoalId: string;
    existed?: boolean;
  };
}
async function plan(userId: string) {
  return (await getMonthlyPlanTool.handler({} as never, { userId } as never)) as {
    total: number;
    done: number;
    goals: { text: string; done: boolean }[];
  };
}

describe('create_monthly_goal — цель месяца + кросс-домен', () => {
  it('пишет на 1-е число месяца юзера (localMonthOnlyUTC)', async () => {
    const u = await mkUser('a@mg.test');
    const res = await create(u.id, 'закрыть 3 сделки');
    const row = await prisma.monthlyGoal.findUnique({ where: { id: res.monthlyGoalId } });
    expect(row?.goalText).toBe('закрыть 3 сделки');
    expect(row?.monthStart.toISOString()).toBe(localMonthOnlyUTC('Asia/Almaty').toISOString());
  });

  it('КРОСС-ДОМЕН: get_monthly_plan (живой ридер) сразу видит цель', async () => {
    const u = await mkUser('b@mg.test');
    await create(u.id, 'нанять дизайнера');
    const p = await plan(u.id);
    expect(p.total).toBe(1);
    expect(p.goals.map((g) => g.text)).toContain('нанять дизайнера');
  });

  it('дедуп: повтор той же цели (регистр) не плодит', async () => {
    const u = await mkUser('c@mg.test');
    await create(u.id, 'выпустить релиз');
    const dup = await create(u.id, 'Выпустить релиз');
    expect(dup.existed).toBe(true);
    expect(await prisma.monthlyGoal.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cross-user: цель A не видна в плане B', async () => {
    const a = await mkUser('d@mg.test');
    const b = await mkUser('e@mg.test');
    await create(a.id, 'личная цель А');
    expect((await plan(b.id)).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run --project integration src/tools/create-monthly-goal.it.test.ts`
Expected: FAIL — модуль `./create-monthly-goal.js` / `./get-monthly-plan.js` не найден.

- [ ] **Step 3: Создай `create-monthly-goal.ts`** (зеркало `create-weekly-goal.ts`, `localMonthOnlyUTC` вместо `localWeekStartUTC`):

```typescript
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { normalizeHabit } from './_habit-match.js';

/**
 * Завести цель на ЭТОТ месяц из чата (аудит-фикс MISSING — раньше MonthlyGoal
 * вообще не было). monthStart = 1-е число месяца юзера (SSOT localMonthOnlyUTC —
 * ровно туда смотрят monthlyPlan-врезка, get_monthly_plan и детектор → цель
 * сразу видна мозгу). Дедуп по нормализованному тексту за месяц.
 * needsConfirm:false (обратимо, не деньги). Кросс-домен: живой monthlyPlan +
 * проактивный detectMonthlyGoalStall (роллап месяц↔неделя).
 */
export const createMonthlyGoalTool = defineTool({
  name: 'create_monthly_goal',
  description:
    'Записать цель на этот месяц («моя цель на июнь — закрыть 3 сделки», ' +
    '«в этом месяце хочу запустить продукт»). Я буду помнить её и напомню к ' +
    'концу месяца, если не закрыта.',
  category: 'task',
  aliases: { goal: 'goalText', text: 'goalText', title: 'goalText', goal_text: 'goalText' },
  schema: z.object({
    goalText: z.string().min(1).max(300),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['моя цель на месяц — закрыть 3 сделки', 'в этом месяце запустить продукт', 'цель месяца: нанять дизайнера'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const tz = await getUserTimezone(userId);
    const monthStart = localMonthOnlyUTC(tz);

    const month = await prisma.monthlyGoal.findMany({
      where: { userId, monthStart },
      select: { id: true, goalText: true },
    });
    // Дедуп: не плодим одинаковые цели месяца.
    const nt = normalizeHabit(input.goalText);
    const dup = month.find((g) => normalizeHabit(g.goalText) === nt);
    if (dup) {
      return {
        message: `Цель месяца «${dup.goalText}» уже записана.`,
        monthlyGoalId: dup.id,
        existed: true,
      };
    }

    const maxOrder = await prisma.monthlyGoal.aggregate({
      where: { userId, monthStart },
      _max: { order: true },
    });
    const goal = await prisma.monthlyGoal.create({
      data: {
        userId,
        monthStart,
        goalText: input.goalText,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return {
      message: `Цель месяца записана: «${goal.goalText}». Всего целей на этот месяц: ${month.length + 1}.`,
      monthlyGoalId: goal.id,
    };
  },
});
```

- [ ] **Step 4: Создай `get-monthly-plan.ts`** (нужен для it-теста; зеркало `get-weekly-plan.ts`):

```typescript
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';

/**
 * Цели/план на ТЕКУЩИЙ месяц (MonthlyGoal): что выполнено, что осталось.
 * monthStart в TZ ЮЗЕРА через localMonthOnlyUTC — SSOT с create_monthly_goal +
 * monthlyPlan-врезкой + детектором.
 */
export const getMonthlyPlanTool = defineTool({
  name: 'get_monthly_plan',
  description:
    'Цели/план на ТЕКУЩИЙ месяц (MonthlyGoal): что выполнено, что осталось. ' +
    'Вызывай на «какие планы на месяц», «что у меня по месяцу», «месячные цели».',
  category: 'task',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['какие планы на месяц', 'что у меня по месяцу', 'месячные цели'],
  handler: async (_input, ctx) => {
    const m = localMonthOnlyUTC(await getUserTimezone(ctx.userId));
    const mg = await prisma.monthlyGoal.findMany({
      where: { userId: ctx.userId, monthStart: m },
      select: { goalText: true, completed: true },
      orderBy: { order: 'asc' },
      take: 12,
    });
    return {
      monthStart: m.toISOString().slice(0, 10),
      done: mg.filter((g) => g.completed).length,
      total: mg.length,
      goals: mg.map((g) => ({ text: g.goalText, done: g.completed })),
    };
  },
});
```

- [ ] **Step 5: Зарегистрируй оба tool в `tools/index.ts`** — добавь импорты (рядом с `createWeeklyGoalTool` :24 и `getWeeklyPlanTool` :37):

```typescript
import { createMonthlyGoalTool } from './create-monthly-goal.js';
import { getMonthlyPlanTool } from './get-monthly-plan.js';
```

И в массив `ALL_TOOLS` — `createMonthlyGoalTool` после `createWeeklyGoalTool` (:82), `getMonthlyPlanTool` рядом с read-only областью (после `getBudgetTool` :72 или в любом месте массива — порядок в массиве не влияет на работу):

```typescript
  createMonthlyGoalTool,
```
```typescript
  getMonthlyPlanTool,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/server && npx vitest run --project integration src/tools/create-monthly-goal.it.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 7: tsc + commit**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/tools/create-monthly-goal.ts packages/server/src/tools/get-monthly-plan.ts packages/server/src/tools/create-monthly-goal.it.test.ts packages/server/src/tools/index.ts
git commit -F - <<'EOF'
feat(month-plan): create_monthly_goal + get_monthly_plan + it-тест (T3)

Писатель пишет MonthlyGoal на localMonthOnlyUTC (SSOT), дедуп normalizeHabit,
order=max+1, needsConfirm:false. Ридер get_monthly_plan на той же точке.
it (real prisma): пишет на 1-е число; кросс-домен ридер видит; дедуп; cross-user.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Врезка «План на месяц» в системный промпт (3-й читатель)

**Files:**
- Modify: `packages/server/src/ai/jarvis-prompt.ts` (тип :82, рендер :186)
- Modify: `packages/server/src/services/assistant-service.ts` (Promise.all + destructure + строка :169 + context :222)

- [ ] **Step 1: Добавь поле в тип контекста** — `jarvis-prompt.ts:82`, сразу ПОСЛЕ `weeklyPlan?: string;`:

```typescript
  monthlyPlan?: string;
```

- [ ] **Step 2: Добавь рендер в промпт** — `jarvis-prompt.ts:186`, сразу ПОСЛЕ строки `if (ctx.weeklyPlan) L.push(\`План на неделю: ${ctx.weeklyPlan}\`);`:

```typescript
  if (ctx.monthlyPlan) L.push(`План на месяц: ${ctx.monthlyPlan}`);
```

- [ ] **Step 3: Добавь импорт `localMonthOnlyUTC` в `assistant-service.ts`** — в существующий импорт из `'../lib/tz.js'` (там уже есть `localWeekStartUTC`, `localDateStr` и др.) добавь `localMonthOnlyUTC`.

- [ ] **Step 4: Добавь fetch месячных целей в `Promise.all`** — в `assistant-service.ts` найди IIFE weekly-плана (заканчивается `})(),` около :154, возвращает `prisma.weeklyGoal.findMany`). Сразу ПОСЛЕ него (новый элемент массива `Promise.all`) добавь:

```typescript
    // meta#9: план на этот месяц (MonthlyGoal, monthStart = 1-е число).
    (() => {
      const md = localMonthOnlyUTC(tz);
      return prisma.monthlyGoal.findMany({
        where: { userId, monthStart: md },
        select: { goalText: true, completed: true },
        orderBy: { order: 'asc' },
        take: 10,
      });
    })(),
```

- [ ] **Step 5: Добавь `monthlyGoals` в деструктуризацию** — в `const [ ... ] = await Promise.all([...])` найди `weeklyGoals` (последний элемент перед `]`) и добавь `monthlyGoals` сразу ПОСЛЕ него (порядок имён ДОЛЖЕН совпадать с порядком элементов в массиве — monthly IIFE добавлен сразу после weekly, значит `monthlyGoals` сразу после `weeklyGoals`):

```typescript
    weeklyGoals,
    monthlyGoals,
```

- [ ] **Step 6: Построй строку `monthlyPlan`** — в `assistant-service.ts` сразу ПОСЛЕ блока `const weeklyPlan = ... : undefined;` (:169-176) добавь зеркальный:

```typescript
  const monthlyPlan =
    monthlyGoals.length > 0
      ? `${monthlyGoals.filter((g) => g.completed).length}/${monthlyGoals.length} — ` +
        monthlyGoals
          .map((g) => `${g.completed ? '✓' : '○'} ${g.goalText}`)
          .slice(0, 6)
          .join('; ')
      : undefined;
```

- [ ] **Step 7: Добавь `monthlyPlan` в объект context** — в `const context: AssistantContext = { ... }` сразу ПОСЛЕ `weeklyPlan,` (:222):

```typescript
    monthlyPlan,
```

- [ ] **Step 8: Verify tsc + быстрый прогон затронутых сьютов**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (если `monthlyGoals` не добавлен в destructure — будет «used before defined» или «cannot find name», это и есть проверка корректности шагов 4-5).

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/ai/jarvis-prompt.ts packages/server/src/services/assistant-service.ts
git commit -F - <<'EOF'
feat(month-plan): врезка «План на месяц» в системный промпт (T4)

3-й живой читатель MonthlyGoal: fetch на localMonthOnlyUTC (SSOT) в gather-
контексте + monthlyPlan в JarvisPromptContext + рендер «План на месяц: …».
Мозг видит цели месяца каждый ход (зеркало weeklyPlan).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Проактивный детектор `monthly_goal_stall` (кросс-домен месяц↔неделя)

**Files:**
- Modify: `packages/server/src/services/v2-proactivity-engine.ts` (union :36, score :92, TEMPLATES :212, imports :274, candidate+detector :835, wiring :972)
- Modify: `packages/server/src/services/v2-proactivity-engine.test.ts` (import :10, exhaustiveness :157, describe :198)

- [ ] **Step 1: Write the failing unit test** — `v2-proactivity-engine.test.ts`: добавь `monthlyStallCandidate` в импорт из `'./v2-proactivity-engine.js'` (рядом с `weeklyStallCandidate`, :10); добавь `'monthly_goal_stall',` в массив exhaustiveness (тот, что `.sort()`, рядом с `'weekly_goal_stall'` :157); добавь describe-блок после `weeklyStallCandidate`-describe (:198):

```typescript
describe('monthlyStallCandidate — проактив «цель месяца не закрыта»', () => {
  const goals = [
    { completed: false, goalText: 'закрыть 3 сделки' },
    { completed: true, goalText: 'нанять дизайнера' },
  ];
  const roll = { done: 2, total: 4 };
  it('≤5 дней до конца + открытая цель → кандидат с роллапом', () => {
    const c = monthlyStallCandidate(3, goals, roll);
    expect(c?.source).toBe('monthly_goal_stall');
    expect(c?.payload.open).toBe(1);
    expect(c?.payload.total).toBe(2);
    expect(c?.payload.sample).toBe('закрыть 3 сделки');
    expect(c?.payload.daysLeft).toBe(3);
    expect(c?.payload.weeksDone).toBe(2);
    expect(c?.payload.weeksTotal).toBe(4);
    expect(c?.significance).toBeGreaterThan(0);
  });
  it('>5 дней до конца → null (рано, не спамим)', () => {
    expect(monthlyStallCandidate(10, goals, roll)).toBeNull();
  });
  it('все цели закрыты → null', () => {
    expect(monthlyStallCandidate(2, [{ completed: true, goalText: 'x' }], roll)).toBeNull();
  });
  it('нет целей месяца → null', () => {
    expect(monthlyStallCandidate(2, [], roll)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts -t monthlyStallCandidate`
Expected: FAIL — `monthlyStallCandidate` не экспортирован.

- [ ] **Step 3a: Расширь union `NudgeSource`** — `v2-proactivity-engine.ts:36`. Замени `  | 'weekly_goal_stall';` на:

```typescript
  | 'weekly_goal_stall'
  | 'monthly_goal_stall';
```

- [ ] **Step 3b: Добавь case в `scoreSignificance`** — сразу ПОСЛЕ case `'weekly_goal_stall'` (:88-92):

```typescript
    case 'monthly_goal_stall': {
      // Месячная цель крупнее недельной — стартовый вес выше.
      const open = Number(c.payload.open ?? 0);
      return Math.min(1, 0.55 + open * 0.12);
    }
```

- [ ] **Step 3c: Добавь шаблон в `TEMPLATES`** — сразу ПОСЛЕ блока `weekly_goal_stall:` (:209-212):

```typescript
  monthly_goal_stall: {
    gentle: 'До конца месяца {{daysLeft}} дн — цель «{{sample}}» ещё не закрыта ({{open}} из {{total}}). За месяц закрыл {{weeksDone}}/{{weeksTotal}} недельных целей — добьём?',
    supportive: 'Осталось {{daysLeft}} дн в месяце, цель «{{sample}}» открыта. Недельных закрыл {{weeksDone}}/{{weeksTotal}} — поднажмём?',
  },
```

- [ ] **Step 3d: Добавь импорты tz** — в блок `import { localDayStartUTC, localHour, localDayOfWeek, localWeekStartUTC } from '../lib/tz.js';` (:269-274) добавь `localMonthOnlyUTC` и `daysUntilMonthEnd`:

```typescript
import {
  localDayStartUTC,
  localHour,
  localDayOfWeek,
  localWeekStartUTC,
  localMonthOnlyUTC,
  daysUntilMonthEnd,
} from '../lib/tz.js';
```

- [ ] **Step 3e: Добавь `monthlyStallCandidate` + `detectMonthlyGoalStall`** — сразу ПОСЛЕ `detectWeeklyGoalStall` (:835):

```typescript
/**
 * Чистое ядро: нужен ли нудж о незакрытой цели месяца. Нудж ТОЛЬКО в последние
 * ~5 дней месяца (daysLeft ≤ 5) и только если есть открытые цели. Роллап
 * месяц↔неделя (done/total недельных целей за месяц) — живой кросс-сигнал.
 * Детерминированно (daysLeft — параметр) → тестируется без «now».
 */
export function monthlyStallCandidate(
  daysLeft: number,
  goals: { completed: boolean; goalText: string }[],
  weekRollup: { done: number; total: number },
): NudgeCandidate | null {
  if (daysLeft > 5) return null;
  const open = goals.filter((g) => !g.completed);
  if (goals.length === 0 || open.length === 0) return null;
  const cand: NudgeCandidate = {
    source: 'monthly_goal_stall',
    significance: 0,
    payload: {
      open: open.length,
      total: goals.length,
      sample: open[0].goalText,
      daysLeft,
      weeksDone: weekRollup.done,
      weeksTotal: weekRollup.total,
    },
    toneHint: 'gentle',
  };
  cand.significance = scoreSignificance(cand);
  return cand;
}

async function detectMonthlyGoalStall(userId: string): Promise<NudgeCandidate[]> {
  try {
    const tz = await getUserTimezone(userId);
    const daysLeft = daysUntilMonthEnd(tz);
    if (daysLeft > 5) return []; // рано — не читаем БД зря
    const monthStart = localMonthOnlyUTC(tz);
    const goals = await prisma.monthlyGoal.findMany({
      where: { userId, monthStart },
      select: { goalText: true, completed: true },
      orderBy: { order: 'asc' },
    });
    // Роллап месяц↔неделя: недельные цели, попавшие в этот месяц.
    const nextMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    );
    const weeks = await prisma.weeklyGoal.findMany({
      where: { userId, weekStart: { gte: monthStart, lt: nextMonth } },
      select: { completed: true },
    });
    const weekRollup = {
      done: weeks.filter((w) => w.completed).length,
      total: weeks.length,
    };
    const cand = monthlyStallCandidate(daysLeft, goals, weekRollup);
    return cand ? [cand] : [];
  } catch (err) {
    console.warn('[v2-proactivity] detectMonthlyGoalStall failed:', err);
    return [];
  }
}
```

- [ ] **Step 3f: Зарегистрируй детектор в `detectCandidates`** — в `Promise.allSettled([...])` сразу ПОСЛЕ `detectWeeklyGoalStall(userId),` (:972):

```typescript
      detectMonthlyGoalStall(userId),
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `cd packages/server && npx vitest run src/services/v2-proactivity-engine.test.ts`
Expected: PASS — `monthlyStallCandidate` (4 теста) + exhaustiveness (`monthly_goal_stall` в union/TEMPLATES) зелёные.

- [ ] **Step 5: tsc + commit**

```bash
cd packages/server && npx tsc --noEmit
git add packages/server/src/services/v2-proactivity-engine.ts packages/server/src/services/v2-proactivity-engine.test.ts
git commit -F - <<'EOF'
feat(month-plan): detectMonthlyGoalStall — проактив «конец месяца» + роллап месяц↔неделя (T5)

NudgeSource monthly_goal_stall + scoreSignificance + TEMPLATES{gentle,supportive}.
Чистая monthlyStallCandidate (daysLeft≤5 + открытые цели). Детектор: daysUntilMonthEnd
гейт → MonthlyGoal за localMonthOnlyUTC + роллап WeeklyGoal в окне месяца (живой
кросс-читатель). Зарегистрирован в detectCandidates. Юниты + exhaustiveness.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Структурный гард-тест + полный verify + независимое ревью

**Files:**
- Create: `packages/server/src/services/monthly-goal-wiring.test.ts`

- [ ] **Step 1: Write structural test** — `monthly-goal-wiring.test.ts` (readFileSync+grep, как `_normalize-wiring.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const TOOLS_INDEX = readFileSync(join(__dirname, '../tools/index.ts'), 'utf8');
const ASSIST = readFileSync(join(__dirname, 'assistant-service.ts'), 'utf8');

describe('monthly-goal wiring — всё связано (гард)', () => {
  it('monthly_goal_stall в union NudgeSource', () => {
    expect(ENGINE).toContain("| 'monthly_goal_stall'");
  });
  it('scoreSignificance обрабатывает monthly_goal_stall', () => {
    expect(ENGINE).toContain("case 'monthly_goal_stall':");
  });
  it('TEMPLATES имеет monthly_goal_stall', () => {
    expect(ENGINE).toContain('monthly_goal_stall: {');
  });
  it('детектор зарегистрирован в detectCandidates', () => {
    expect(ENGINE).toContain('detectMonthlyGoalStall(userId),');
  });
  it('детектор имеет ранний выход по daysUntilMonthEnd>5', () => {
    expect(ENGINE).toContain('if (daysLeft > 5) return [];');
  });
  it('детектор читает MonthlyGoal на localMonthOnlyUTC (SSOT)', () => {
    expect(ENGINE).toContain('localMonthOnlyUTC(tz)');
    expect(ENGINE).toContain('prisma.monthlyGoal.findMany');
  });
  it('роллап месяц↔неделя читает WeeklyGoal в окне месяца', () => {
    expect(ENGINE).toContain('weekStart: { gte: monthStart, lt: nextMonth }');
  });
  it('оба tool зарегистрированы', () => {
    expect(TOOLS_INDEX).toContain('createMonthlyGoalTool');
    expect(TOOLS_INDEX).toContain('getMonthlyPlanTool');
  });
  it('врезка monthlyPlan в gather-контексте', () => {
    expect(ASSIST).toContain('monthlyPlan');
    expect(ASSIST).toContain('prisma.monthlyGoal.findMany');
  });
});
```

- [ ] **Step 2: Run structural test**

Run: `cd packages/server && npx vitest run src/services/monthly-goal-wiring.test.ts`
Expected: PASS (9 тестов).

- [ ] **Step 3: Полный verify**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: tsc чисто; unit ~2471+ (baseline 2467 + новые) зелёные; 0 падений.

Run: `cd packages/server && npx vitest run --project integration`
Expected: ~126 (baseline 122 + 4 новых it) зелёные.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/monthly-goal-wiring.test.ts
git commit -F - <<'EOF'
test(month-plan): структурный гард-тест wiring + полный verify зелёный (T6)

monthly_goal_stall в union/score/TEMPLATES/detectCandidates; ранний выход
daysLeft>5; SSOT localMonthOnlyUTC писатель↔читатели; роллап месяц↔неделя;
оба tool зарегистрированы; врезка на месте.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Независимое ревью** — dispatch `pr-review-toolkit:code-reviewer` на дифф `<baseline>..HEAD -- packages/server` (+ prisma). Фокус:
  - **SSOT** `localMonthOnlyUTC`: писатель (create_monthly_goal) и ВСЕ 3 читателя (get_monthly_plan, assistant-service врезка, detectMonthlyGoalStall) считают `monthStart` одной точкой → цель видна каждому.
  - **Миграция прод-безопасна**: `CREATE TABLE/INDEX IF NOT EXISTS` + FK через `DO`; новая таблица (0 риска для данных); `"order"` заквочен (reserved word).
  - **`daysUntilMonthEnd`** tz-aware на границе месяца (не серверный UTC); юнит покрывает.
  - **Детектор не спамит**: только `daysLeft ≤ 5` + открытые цели; ранний выход до чтения БД; внутри уже включённой проактивности (engine cooldown).
  - **Роллап месяц↔неделя** — живой `WeeklyGoal`-читатель в окне `[monthStart, nextMonth)`, не заглушка.
  - **Exhaustiveness**: `monthly_goal_stall` покрыт в scoreSignificance (tsc) + TEMPLATES (тест).
  - **destructure-порядок** assistant-service: `monthlyGoals` стоит ровно после `weeklyGoals` (соответствует порядку элементов Promise.all).

  Если ревью даёт BLOCKER/IMPORTANT — пофиксить + перепрогон, иначе доклад Berik + предложить деплой (push/deploy ТОЛЬКО по его слову; миграция применится на деплое).

---

## Self-Review (выполнено при написании плана)

**1. Spec coverage:** Модель+миграция (T2 ✓), create_monthly_goal (T3 ✓), get_monthly_plan (T3 ✓), врезка (T4 ✓), daysUntilMonthEnd (T1 ✓), detectMonthlyGoalStall+роллап (T5 ✓), флаг-нет/деплой-с-миграцией (T2/T6 ✓), тесты pure+it+структурный (T1/T3/T5/T6 ✓). Все требования спеки покрыты.

**2. Placeholder scan:** Полный код в каждом шаге; команды с ожидаемым выводом; нет TBD/«similar to».

**3. Type consistency:** `localMonthOnlyUTC`/`daysUntilMonthEnd` (tz.ts) — единые имена в T1/T3/T4/T5. `monthlyStallCandidate(daysLeft, goals, weekRollup)` — сигнатура совпадает в тесте (T5 step1) и реализации (T5 step3e). Payload-ключи `{open,total,sample,daysLeft,weeksDone,weeksTotal}` — совпадают между candidate, TEMPLATES-vars и тестом. `monthlyGoalId` — в writer-return и it-тесте. `prisma.monthlyGoal` — после T2 generate.
