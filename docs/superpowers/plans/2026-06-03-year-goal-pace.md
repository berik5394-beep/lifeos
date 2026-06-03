# Year Goal-Pace Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Годовая цель оживает: «прочитал 25 книг» обновляет прогресс, и бот говорит, успеваешь ли к концу года (пейсинг измеримых не-денежных целей). Зеркало savings-coach.

**Architecture:** Y1 — инструмент `update_goal_progress` (захват прогресса). Y2 — `goal-pace.ts` (`computeGoalPace` поверх прод-`computeSavingsPace`) реактивно в инструменте + проактивно доп-веткой дневного рефлектора. Флаг `FEATURE_V2_YEAR_LOAD`. Деньги-цели исключены (savings-coach владеет); savings-pace/coach не правим.

**Tech Stack:** packages/server, strict TS, ESM NodeNext ('.js'), vitest zero vi.mock, структурные тесты readFileSync+grep.

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit. Команды из `packages/server`. heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. База сюиты **2158** зелёная. Без миграции. Флаг off → прогресс пишется, пейсинг молчит.

---

## Task 1: Флаг `isV2YearLoadEnabled`

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Test** — в `feature-flags.test.ts` добавить `isV2YearLoadEnabled` к импорту и describe перед `describe('isV2MonthLoadEnabled'`:

```ts
describe('isV2YearLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_YEAR_LOAD;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FEATURE_V2_YEAR_LOAD;
    else process.env.FEATURE_V2_YEAR_LOAD = ORIG;
  });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_YEAR_LOAD;
    expect(isV2YearLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_YEAR_LOAD = 'all';
    expect(isV2YearLoadEnabled('u1')).toBe(true);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/lib/feature-flags.test.ts` → FAIL.

- [ ] **Step 3: Impl** — после `isV2MonthLoadEnabled` в `feature-flags.ts`:

```ts
/** Движок пересечения, горизонт ГОД (пейсинг измеримых целей). Off → байт-в-байт. */
export function isV2YearLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_YEAR_LOAD, userId);
}
```

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/lib/feature-flags.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -F - <<'EOF'
feat(engine): isV2YearLoadEnabled flag (FEATURE_V2_YEAR_LOAD)

Gates the YEAR horizon (measurable goal-pace coach): reactive line + reflector
branch. Off → progress still writes, pacing silent.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `goal-pace.ts` — чистое ядро (isMoneyGoal + computeGoalPace + describeGoalPace)

**Files:** Create `src/services/goal-pace.ts`, `src/services/goal-pace.test.ts`

- [ ] **Step 1: Failing test** — `goal-pace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMoneyGoal, computeGoalPace, describeGoalPace } from './goal-pace.js';

describe('isMoneyGoal', () => {
  it('finance + target → деньги (исключаем)', () => {
    expect(isMoneyGoal('finance', 1_000_000)).toBe(true);
  });
  it('finance без target → не деньги', () => {
    expect(isMoneyGoal('finance', null)).toBe(false);
  });
  it('career/health → не деньги', () => {
    expect(isMoneyGoal('career', 50)).toBe(false);
    expect(isMoneyGoal('health', 10)).toBe(false);
  });
});

describe('computeGoalPace', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-01T00:00:00Z'); // ~6 мес прошло
  it('reached → status reached', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 100, createdAt: created }, now);
    expect(p.status).toBe('reached');
    expect(p.done).toBe(50);
  });
  it('behind: 20% за полгода, цель к концу года', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 20, createdAt: created }, now);
    // done=10, monthsElapsed~6 → currentMonthly~1.6; remaining 40 за ~6 мес → required~6.6 → behind
    expect(p.status).toBe('behind');
    expect(Math.round(p.done)).toBe(10);
    expect(p.currentMonthly).toBeGreaterThan(0);
  });
  it('monthsElapsed<0.5 → currentMonthly 0', () => {
    const fresh = new Date('2026-06-28T00:00:00Z');
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 10, createdAt: fresh }, now);
    expect(p.currentMonthly).toBe(0);
    expect(p.monthsElapsed).toBeLessThan(0.5);
  });
  it('target=0 → done 0, no_target', () => {
    const p = computeGoalPace({ target: 0, targetDate: null, progress: 50, createdAt: created }, now);
    expect(p.done).toBe(0);
    expect(p.status).toBe('no_target');
  });
});

describe('describeGoalPace', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-07-01T00:00:00Z');
  it('behind → строка с «нужно ~X/мес»', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 20, createdAt: created }, now);
    const s = describeGoalPace('Прочитать 50 книг', p, 50)!;
    expect(s).toContain('Прочитать 50 книг');
    expect(s).toContain('нужно');
    expect(s).toContain('из 50');
  });
  it('reached → null', () => {
    const p = computeGoalPace({ target: 50, targetDate: null, progress: 100, createdAt: created }, now);
    expect(describeGoalPace('x', p, 50)).toBeNull();
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/goal-pace.test.ts` → FAIL.

- [ ] **Step 3: Impl** — `src/services/goal-pace.ts`:

```ts
import { computeSavingsPace, type SavingsStatus } from './savings-pace.js';

const MS_PER_MONTH = 30.44 * 86_400_000;
const MIN_ELAPSED_MONTHS = 0.5; // раньше — темп не считаем (мало данных)
const FIN_RE = /financ|финанс/i;

/** Денежная цель (ими владеет savings-coach) → исключаем из пейсинга. */
export function isMoneyGoal(area: string, target: number | null): boolean {
  return FIN_RE.test(area) && target != null;
}

export interface GoalPace {
  status: SavingsStatus;
  requiredMonthly: number;
  currentMonthly: number;
  done: number;
  monthsLeft: number;
  monthsElapsed: number;
}

/** Дек 31 указанного года, 23:59 UTC (грубый дедлайн по умолчанию). */
function dec31(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 0));
}

/**
 * Пейсинг измеримой цели поверх computeSavingsPace. done = progress%/100*target;
 * темп = done / прошедшие месяцы (с createdAt); дедлайн = targetDate ?? 31 дек.
 */
export function computeGoalPace(
  g: { target: number; targetDate: Date | null; progress: number; createdAt: Date },
  now: Date,
): GoalPace {
  const target = g.target > 0 ? g.target : 0;
  const done = (g.progress / 100) * target;
  const targetDate = g.targetDate ?? dec31(now.getUTCFullYear());
  const monthsElapsed = Math.max(0, (now.getTime() - g.createdAt.getTime()) / MS_PER_MONTH);
  const currentMonthly = monthsElapsed >= MIN_ELAPSED_MONTHS ? done / monthsElapsed : 0;
  const pace = computeSavingsPace({
    target,
    targetDate,
    savedSoFar: done,
    monthlyPace: currentMonthly,
    now,
  });
  return {
    status: pace.status,
    requiredMonthly: pace.requiredMonthly,
    currentMonthly,
    done,
    monthsLeft: pace.monthsLeft,
    monthsElapsed,
  };
}

/**
 * Человеческая строка. null если успеваешь/достиг/нет цели. Иначе (behind/
 * stalled): «нужно ~X/мес»; «твой темп» — только если данных достаточно
 * (monthsElapsed≥MIN).
 */
export function describeGoalPace(goalText: string, p: GoalPace, target: number): string | null {
  if (p.status === 'reached' || p.status === 'on_track' || p.status === 'ahead' || p.status === 'no_target') {
    return null;
  }
  const r = (n: number) => Math.round(n);
  const tempo =
    p.monthsElapsed >= MIN_ELAPSED_MONTHS ? ` твой темп ~${r(p.currentMonthly)}/мес.` : '';
  return (
    `📚 «${goalText}»: ${r(p.done)} из ${target}, осталось ~${r(p.monthsLeft)} мес — ` +
    `нужно ~${r(p.requiredMonthly)}/мес.${tempo} Поднажми.`
  );
}
```

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/goal-pace.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/goal-pace.ts packages/server/src/services/goal-pace.test.ts && git commit -F - <<'EOF'
feat(year): goal-pace pure core — isMoneyGoal + computeGoalPace + describe

Generalizes the savings-pace math to any measurable non-money yearly goal
(done = progress%/100*target, deadline ?? Dec31, rate from createdAt). Reuses
computeSavingsPace unmodified.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `goal-pace.ts` — `maybeGoalPaceLine` (реактив + дедуп)

**Files:** Modify `src/services/goal-pace.ts`, `src/services/goal-pace.test.ts`

- [ ] **Step 1: Failing test** — добавить в `goal-pace.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('goal-pace — проводка maybeGoalPaceLine (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/goal-pace.ts'), 'utf-8');
  it('гейт флагом + дедуп против СВОИХ goal:pace + source goal_pace', () => {
    expect(SRC).toContain('isV2YearLoadEnabled');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'goal_pace'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'goal:pace:'");
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/goal-pace.test.ts` → FAIL.

- [ ] **Step 3: Impl** — в `goal-pace.ts`: расширить импорты (вверху файла) и дописать функцию в конец:

Заменить первую строку импорта:
```ts
import { computeSavingsPace, type SavingsStatus } from './savings-pace.js';
```
на блок:
```ts
import { computeSavingsPace, type SavingsStatus } from './savings-pace.js';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2YearLoadEnabled } from '../lib/feature-flags.js';
```

В конец файла:
```ts

/**
 * Реактивная строка пейсинга для ОДНОЙ цели. Best-effort (→null), гейт флагом,
 * дедуп ≤1/день против СВОИХ (source 'goal_pace'). Зеркало maybeSavingsCoachLine.
 */
export async function maybeGoalPaceLine(
  userId: string,
  goalId: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2YearLoadEnabled(userId)) return null;
  try {
    const g = await prisma.yearlyGoal.findFirst({
      where: { id: goalId, userId },
      select: { goalText: true, area: true, target: true, targetDate: true, progress: true, createdAt: true },
    });
    if (!g || g.target == null || isMoneyGoal(g.area, g.target)) return null;

    const pace = computeGoalPace(
      { target: g.target, targetDate: g.targetDate, progress: g.progress, createdAt: g.createdAt },
      now,
    );
    const line = describeGoalPace(g.goalText, pace, g.target);
    if (!line) return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const scopeKey = 'goal:pace:' + goalId;
    const seen = await prisma.insight.count({
      where: { userId, scopeKey, source: 'goal_pace', createdAt: { gte: dayStart } },
    });
    if (seen > 0) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 4,
          scope: { key: scopeKey, kind: 'goal_pace_reactive' },
          scopeKey,
          source: 'goal_pace',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[goal-pace] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/services/goal-pace.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/goal-pace.ts packages/server/src/services/goal-pace.test.ts && git commit -F - <<'EOF'
feat(year): maybeGoalPaceLine — reactive per-goal pace, flag-gated, deduped

Best-effort line for one measurable non-money goal; ≤1/day dedup vs own source
'goal_pace'. Mirrors maybeSavingsCoachLine.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Инструмент `update_goal_progress` + регистрация + реактив

**Files:** Create `src/tools/update-goal-progress.ts`, `src/tools/update-goal-progress.test.ts`; Modify `src/tools/index.ts`

**Контекст:** паттерн defineTool — см. `src/tools/suggest-goal.ts` (name/description/category/aliases/schema zod/needsConfirm/sideEffects/examples/handler(input,ctx)). `ctx.userId` есть. prisma импортируется напрямую. `captureActivity(userId, {type,content})` из `../services/tool-activity-summary.js`. Текущий локальный год: `Number(localDateStr(tz, now).split('-')[0])`.

- [ ] **Step 1: Failing test** — `update-goal-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateGoalProgressTool } from './update-goal-progress.js';
import { pctFromValue } from './update-goal-progress.js';

describe('pctFromValue — конвертация в проценты', () => {
  it('абсолют 25 из 50 → 50%', () => {
    expect(pctFromValue(25, 50, false)).toBe(50);
  });
  it('valueIsPercent → как есть, кламп', () => {
    expect(pctFromValue(80, 50, true)).toBe(80);
    expect(pctFromValue(150, 50, true)).toBe(100);
  });
  it('target<=0 → 0', () => {
    expect(pctFromValue(25, 0, false)).toBe(0);
  });
  it('абсолют выше target → кламп 100', () => {
    expect(pctFromValue(60, 50, false)).toBe(100);
  });
});

describe('update-goal-progress — структура (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/tools/update-goal-progress.ts'), 'utf-8');
  it('резолв измеримой не-денежной цели + ветки 0/много без записи', () => {
    expect(SRC).toContain('isMoneyGoal');
    expect(SRC).toContain("year:");
    expect(SRC).toContain('target: { not: null }');
    expect(SRC).toContain('contains:');
    expect(SRC).toMatch(/length === 0/);
    expect(SRC).toMatch(/length > 1/);
  });
  it('пишет progress + captureActivity + реактив maybeGoalPaceLine', () => {
    expect(SRC).toContain('yearlyGoal.update');
    expect(SRC).toContain('captureActivity');
    expect(SRC).toContain('maybeGoalPaceLine');
  });
  it('зарегистрирован в реестре tools/index', () => {
    const IDX = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');
    expect(IDX).toContain('updateGoalProgressTool');
  });
  it('tool name', () => {
    expect(updateGoalProgressTool.name).toBe('update_goal_progress');
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/tools/update-goal-progress.test.ts` → FAIL.

- [ ] **Step 3: Impl tool** — `src/tools/update-goal-progress.ts`:

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { isMoneyGoal, maybeGoalPaceLine } from '../services/goal-pace.js';

/** value → проценты 0..100. Абсолют (25 из 50 → 50) или уже-проценты (кламп). Чистая. */
export function pctFromValue(value: number, target: number, isPercent: boolean): number {
  const raw = isPercent ? value : target > 0 ? (value / target) * 100 : 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export const updateGoalProgressTool = defineTool({
  name: 'update_goal_progress',
  description:
    'Обнови прогресс ГОДОВОЙ ИЗМЕРИМОЙ цели по словам пользователя: ' +
    '«прочитал 25 книг», «сбросил 3 кг», «выучил 400 слов», «пробежал 100 км». ' +
    'goalQuery — про какую цель (часть текста цели), value — число ' +
    '(новый итог), valueIsPercent=true если это уже проценты.',
  category: 'task',
  aliases: { goal: 'goalQuery', query: 'goalQuery', amount: 'value', count: 'value' },
  schema: z.object({
    goalQuery: z.string().min(2).max(120).describe('часть текста годовой цели: «книг», «английск», «вес»'),
    value: z.number().min(0).max(1_000_000_000).describe('новый КУМУЛЯТИВНЫЙ итог: 25 (книг)'),
    valueIsPercent: z.boolean().optional().describe('true если value — это проценты 0..100'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['прочитал 25 книг', 'сбросил 3 кг', 'выучил 400 слов'],
  handler: async (input, ctx) => {
    const now = new Date();
    const tz = await getUserTimezone(ctx.userId);
    const year = Number(localDateStr(tz, now).split('-')[0]);

    const candidates = (
      await prisma.yearlyGoal.findMany({
        where: {
          userId: ctx.userId,
          year,
          target: { not: null },
          goalText: { contains: input.goalQuery, mode: 'insensitive' },
        },
        select: { id: true, goalText: true, area: true, target: true },
      })
    ).filter((g) => !isMoneyGoal(g.area, g.target));

    if (candidates.length === 0) {
      return {
        message: `Не нашёл измеримую годовую цель про «${input.goalQuery}». Скажи точнее или поставь цель.`,
      };
    }
    if (candidates.length > 1) {
      const list = candidates.map((g) => `«${g.goalText}»`).join(' / ');
      return { message: `Какую цель обновить: ${list}? Уточни.` };
    }

    const g = candidates[0];
    const target = g.target ?? 0;
    const pct = pctFromValue(input.value, target, input.valueIsPercent === true);
    await prisma.yearlyGoal.update({ where: { id: g.id }, data: { progress: pct } });

    captureActivity(ctx.userId, {
      type: 'goal_progress_updated',
      content: `Прогресс цели «${g.goalText}»: ${input.value} из ${target} (${pct}%)`,
    });

    const base = `Отметил по «${g.goalText}»: ${input.value} из ${target} (${pct}%).`;
    const pace = await maybeGoalPaceLine(ctx.userId, g.id, now);
    return { message: pace ? `${base}\n\n${pace}` : base };
  },
});
```

- [ ] **Step 4: Register** — в `src/tools/index.ts`: добавить импорт рядом с `import { suggestGoalTool } from './suggest-goal.js';`:

```ts
import { updateGoalProgressTool } from './update-goal-progress.js';
```

и в массив инструментов (рядом со строкой `  suggestGoalTool,`):

```ts
  updateGoalProgressTool,
```

- [ ] **Step 5: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/tools/update-goal-progress.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/update-goal-progress.ts packages/server/src/tools/update-goal-progress.test.ts packages/server/src/tools/index.ts && git commit -F - <<'EOF'
feat(year): update_goal_progress tool — capture measurable goal progress

"прочитал 25 книг" → resolves the measurable non-money yearly goal, writes
progress% (clamped), captureActivity, and appends the reactive pace line.
0/many matches → asks, no write. Registered in the tool registry.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Проактив — ветка goal-pace в дневном рефлекторе

**Files:** Modify `src/services/reflector-core.ts`, `src/services/reflector-service.ts`, `src/services/reflector-core.test.ts` (или создать структурный тест если файла нет — проверить)

**Контекст (прочитать перед правкой):** `reflect(f: ReflectorFacts): InsightCandidate[]` — ЧИСТАЯ (reflector-core.ts:87), пушит кандидаты `{kind, scope, severity, message, rationale?, source, dismissKey?}`. Денежный pacing гейтится `f.pacingEnabled` (:118). `ReflectorFacts` определён :25. `gatherReflectorFacts` (reflector-service.ts:28) уже делает `prisma.yearlyGoal.findMany` (:53) — РАСШИРИТЬ его select и собрать measurableGoals. Гард свежести: пропускаем цели с `monthsElapsed < 0.5` (не нудим про только что поставленные).

- [ ] **Step 1: Failing test** — добавить структурный тест. Проверить наличие `src/services/reflector-core.test.ts`; если есть — добавить, если нет — создать `src/services/reflector-goalpace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reflector — проактивная ветка goal-pace (structural)', () => {
  const CORE = readFileSync(join(process.cwd(), 'src/services/reflector-core.ts'), 'utf-8');
  const SVC = readFileSync(join(process.cwd(), 'src/services/reflector-service.ts'), 'utf-8');
  it('reflect: ветка measurableGoals + describeGoalPace + source goal_pace', () => {
    expect(CORE).toContain('measurableGoals');
    expect(CORE).toContain('describeGoalPace');
    expect(CORE).toContain("source: 'goal_pace'");
  });
  it('reflect: гейт yearPacingEnabled + гард свежести monthsElapsed', () => {
    expect(CORE).toContain('yearPacingEnabled');
    expect(CORE).toContain('monthsElapsed');
  });
  it('gather: populate measurableGoals + yearPacingEnabled через isV2YearLoadEnabled', () => {
    expect(SVC).toContain('measurableGoals');
    expect(SVC).toContain('isV2YearLoadEnabled');
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/reflector-goalpace.test.ts` (или reflector-core.test.ts) → FAIL.

- [ ] **Step 3a: ReflectorFacts** — в `reflector-core.ts` в `interface ReflectorFacts` (после поля `now`) добавить:

```ts
  /** ГОД-пейсинг: измеримые НЕ-денежные цели для goal-pace ветки. */
  measurableGoals: {
    id: string;
    goalText: string;
    target: number;
    targetDate: Date | null;
    progress: number;
    createdAt: Date;
  }[];
  /** Флаг ГОД-пейсинга (isV2YearLoadEnabled). */
  yearPacingEnabled: boolean;
```

- [ ] **Step 3b: reflect() ветка** — в `reflector-core.ts` импорт вверху (рядом с импортом savings):

```ts
import { computeGoalPace, describeGoalPace } from './goal-pace.js';
```

В `reflect()` ПЕРЕД `return out;` добавить:

```ts
  // 4. ГОД-пейсинг измеримых не-денежных целей (additive, под флагом).
  //    Деньги уже покрыты блоком выше; здесь — книги/вес/навыки.
  if (f.yearPacingEnabled) {
    for (const g of f.measurableGoals) {
      const pace = computeGoalPace(
        { target: g.target, targetDate: g.targetDate, progress: g.progress, createdAt: g.createdAt },
        f.now,
      );
      if (pace.monthsElapsed < 0.5) continue; // не нудим про свежие цели
      const line = describeGoalPace(g.goalText, pace, g.target);
      if (!line) continue;
      out.push({
        kind: 'goal_pace_behind',
        scope: 'goal:pace:' + g.id,
        severity: 4,
        message: line,
        rationale: `goal pace ${pace.status} done=${Math.round(pace.done)}/${g.target}`,
        source: 'goal_pace',
        dismissKey: 'reflector_goal_pace_' + g.id,
      });
    }
  }
```

- [ ] **Step 3c: gather populate** — в `reflector-service.ts`: убедиться, что `yearlyGoal.findMany` select включает `id, goalText, area, target, targetDate, progress, createdAt` (добавить недостающие поля к существующему select). Добавить импорт:

```ts
import { isV2YearLoadEnabled } from '../lib/feature-flags.js';
import { isMoneyGoal } from './goal-pace.js';
```

В объект фактов, который возвращает `gatherReflectorFacts` (рядом с прочими полями), добавить:

```ts
    measurableGoals: goals
      .filter((g) => g.target != null && !isMoneyGoal(g.area, g.target))
      .map((g) => ({
        id: g.id,
        goalText: g.goalText,
        target: g.target as number,
        targetDate: g.targetDate,
        progress: g.progress,
        createdAt: g.createdAt,
      })),
    yearPacingEnabled: isV2YearLoadEnabled(userId),
```

(Если `goals` в gather не содержит нужных полей — расширить его `select`. Прочитать строки 53-92 и привести в соответствие.)

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/services/reflector-goalpace.test.ts && npx tsc --noEmit` → PASS, 0. Затем прогнать существующие reflector-тесты: `npx vitest run src/services/reflector` → все зелёные (money-путь не сломан).

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/reflector-core.ts packages/server/src/services/reflector-service.ts packages/server/src/services/reflector-goalpace.test.ts && git commit -F - <<'EOF'
feat(year): proactive goal-pace branch in daily reflector (flag-gated)

Additive: for measurable non-money goals, computeGoalPace → describeGoalPace →
InsightCandidate (source 'goal_pace'), gated by yearPacingEnabled, skipping
fresh goals (<0.5mo). Money portfolio branch untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Финальная сверка + независимое ревью

- [ ] **Step 1: Full suite + tsc** — `cd packages/server && npx vitest run && npx tsc --noEmit` → все зелёные (2158 + новые), 0.

- [ ] **Step 2: Изоляция** — savings не изменён:

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS && git diff --name-only 84c8824..HEAD -- packages/server/src | grep -E "savings-pace.ts|savings-coach.ts" || echo "(savings untouched — ок)"`
Expected: `(savings untouched — ок)`.

- [ ] **Step 3: Независимое ревью** (`superpowers:code-reviewer`) на диффе `84c8824..HEAD`. Инварианты:
  - Флаг off → инструмент пишет progress, но НЕ дописывает пейсинг; reflector goal-pace ветка молчит; money-путь рефлектора байт-в-байт.
  - Деньги-цели исключены из пейсинга (isMoneyGoal) — нет двойного коуча с savings.
  - `update_goal_progress`: 0 совпадений → текст без записи; >1 → уточнение без записи; ровно 1 → update. Единицы: pctFromValue(25,50,false)=50, кламп [0,100].
  - `computeGoalPace`: done=progress/100*target; reuse computeSavingsPace; monthsElapsed<0.5 → currentMonthly 0; target=0 → no_target.
  - Дедуп vs own source 'goal_pace', scopeKey 'goal:pace:'+goalId.
  - best-effort: maybeGoalPaceLine/reflector-ветка не валят вызывающего.
  - reflector: ветка additive, money portfolio-блок не тронут; reflect остаётся чистой (флаг через facts.yearPacingEnabled, не env).
  - savings-pace.ts/savings-coach.ts не изменены.

- [ ] **Step 4:** Память (observation + roadmap «ГОД done — пейсинг измеримых целей; движок ЗАВЕРШЁН: день→неделя→месяц→год») + предложить деплой (флаг `FEATURE_V2_YEAR_LOAD` через account-token+curl после явного слова Berik).

---

## Self-Review (автор)

**Spec coverage:** §1 конвенции→Task4 (pctFromValue %)+Task2 (done round-trip); §2.1 инструмент→Task4; §3.1 isMoneyGoal/computeGoalPace/describeGoalPace→Task2; §3.2 maybeGoalPaceLine→Task3; §3.3 рефлектор→Task5; §4 флаг→Task1; §5 тесты→в каждой; §6 инварианты→Task6.

**Placeholders:** нет. Все code-блоки полные. (Task 5 Step 3c содержит «прочитать строки 53-92 и привести select» — это уточнение существующего select под точные поля, не плейсхолдер логики; ветка и факты заданы полностью.)

**Type consistency:** `computeGoalPace(g{target,targetDate,progress,createdAt}, now)→GoalPace{status,requiredMonthly,currentMonthly,done,monthsLeft,monthsElapsed}` — едино Task2↔Task3↔Task5. `describeGoalPace(goalText, p:GoalPace, target)` — едино. `isMoneyGoal(area,target)` — Task2, исп. Task4/Task5. `maybeGoalPaceLine(userId,goalId,now)` — Task3, исп. Task4. `pctFromValue(value,target,isPercent)` — Task4. Флаг `isV2YearLoadEnabled` — Task1, исп. Task3/Task5. Source 'goal_pace' / scopeKey 'goal:pace:'+id — Task3==Task5. Базовая ревизия изоляции = `84c8824`.

**Риск:** Task 5 трогает критичный pure-рефлектор — изолирован, флаг-гейт, money-блок не тронут, структурный тест + прогон существующих reflector-тестов в Step 4. Если при исполнении select/факты окажутся запутаны — чекпойнт с Berik.
