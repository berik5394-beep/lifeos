# Month-Load Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Бот предупреждает «в этом месяце не всё влезет» — когда Σ времени задач+недельных целей месяца превышает свободное время оставшихся дней месяца. Каскад day→week→month: показываем самый ближний перегруженный горизонт.

**Architecture:** Третий горизонт на ТОМ ЖЕ ядре `computeCapacityFit`. Изолированный `services/month-load.ts` — зеркало `week-load.ts`. Новый additive tz-хелпер `localMonthStartUTC`. Реактив каскадом в `create_task`. Деньги/день/неделя не правим (day-load/week-load только импортируются).

**Tech Stack:** packages/server, strict TS, ESM NodeNext ('.js'), vitest zero vi.mock, структурные тесты readFileSync+grep, pure helpers для юнитов.

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit. Команды из `packages/server`. Коммит heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. База сюиты **2150** зелёная. Флаг `FEATURE_V2_MONTH_LOAD` уже =all в проде → деплой кода активирует нудж сразу.

---

## Task 1: tz-хелпер `localMonthStartUTC`

**Files:**
- Modify: `packages/server/src/lib/tz.ts` (после `localDayStartUTC`, ~строка 82)
- Modify: `packages/server/src/lib/tz.test.ts`

- [ ] **Step 1: Failing test** — в `tz.test.ts` добавить `localMonthStartUTC` к импорту из `'./tz.js'` и describe-блок в конец файла:

```ts
describe('localMonthStartUTC — начало локального месяца как UTC', () => {
  it('середина месяца (Алматы UTC+5) → 1-е 00:00 локально = пред. день 19:00 UTC', () => {
    // 2026-05-16T19:30Z → локально 17 мая; месяц = май; 1 мая 00:00 Алматы = 30 апр 19:00 UTC
    const r = localMonthStartUTC('Asia/Almaty', new Date('2026-05-16T19:30:00Z'));
    expect(r.toISOString()).toBe('2026-04-30T19:00:00.000Z');
  });
  it('переход года: декабрь → 1 декабря', () => {
    const r = localMonthStartUTC('Asia/Almaty', new Date('2026-12-20T10:00:00Z'));
    expect(r.toISOString()).toBe('2026-11-30T19:00:00.000Z');
  });
  it('невалидная tz → не падает (фолбэк UTC, 1-е 00:00 UTC)', () => {
    const r = localMonthStartUTC('Garbage/Zone', new Date('2026-05-16T10:00:00Z'));
    expect(r.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/lib/tz.test.ts` → FAIL (нет экспорта `localMonthStartUTC`).

- [ ] **Step 3: Impl** — в `tz.ts` сразу после функции `localDayStartUTC` (после её закрывающей `}` на ~строке 82) вставить:

```ts

/**
 * UTC-инстант 00:00 ЛОКАЛЬНОГО 1-го числа месяца, в который попадает
 * `at`. Копия localDayStartUTC, но день=1. DST-устойчиво (re-нормализация
 * смещения; KZ без DST → точно). Для границ месяца в month-load.
 */
export function localMonthStartUTC(tz: string, at: Date = new Date()): Date {
  const zone = safeTz(tz);
  const [y, m] = localDateStr(zone, at).split('-').map(Number);
  const guessUTC = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const off = tzOffsetMs(zone, new Date(guessUTC));
  return new Date(guessUTC - off);
}
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/lib/tz.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/tz.ts packages/server/src/lib/tz.test.ts && git commit -F - <<'EOF'
feat(tz): localMonthStartUTC — local month-start as UTC instant

Mirror of localDayStartUTC with day=1. tz-aware month boundaries for the
month-load slice. DST-tolerant (re-normalized offset).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `month-load.ts` — адаптер + хук

**Files:**
- Create: `packages/server/src/services/month-load.ts`
- Create: `packages/server/src/services/month-load.test.ts`

**Контекст:** зеркало `week-load.ts` (прочитать целиком перед импл). Отличия: границы месяца (`localMonthStartUTC`), demand включает И задачи, И недельные цели; scope `month`.

- [ ] **Step 1: Failing test** — создать `month-load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMonthLoad } from './month-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('describeMonthLoad', () => {
  it('overloaded → строка «следующий месяц» + overflow + вопрос', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'прочитать книгу', demand: 120, importance: 1 },
      ],
    });
    const s = describeMonthLoad(fit)!;
    expect(s).toContain('В этом месяце');
    expect(s).toContain('прочитать книгу');
    expect(s).toContain('следующий месяц');
  });
  it('fits → null', () => {
    expect(describeMonthLoad(computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] }))).toBeNull();
  });
});

describe('month-load — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/month-load.ts'), 'utf-8');
  it('maybeMonthLoadLine: флаг + fit + дедуп против СВОИХ time:month_load', () => {
    expect(SRC).toContain('isV2MonthLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'month_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:month_load'");
  });
  it('gatherMonthLoad: задачи + недельные цели + sumWeekCapacity + границы месяца', () => {
    expect(SRC).toContain('localMonthStartUTC');
    expect(SRC).toContain('sumWeekCapacity');
    expect(SRC).toContain('weeklyGoal.findMany');
    expect(SRC).toContain('DEFAULT_GOAL_MINUTES');
    expect(SRC).toContain('estimatedMinutes ??');
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/services/month-load.test.ts` → FAIL (модуля нет).

- [ ] **Step 3: Impl** — создать `month-load.ts`:

```ts
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localMonthStartUTC, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2MonthLoadEnabled } from '../lib/feature-flags.js';
import { sumWeekCapacity } from '../tools/_slots.js';
import { computeCapacityFit, type CapacityFit, type CapacityItem } from './capacity-fit.js';
import { mapPriority, DEFAULT_TASK_MINUTES } from './day-load.js';
import { DEFAULT_GOAL_MINUTES } from './estimate-goal-minutes.js';

const DAY_MS = 86_400_000;
const MONTH_LOAD_SCOPE = 'time:month_load';
const GOAL_IMPORTANCE = 2; // у WeeklyGoal нет priority — фикс. средняя

/** Строка о перегрузе месяца. null если влезает. */
export function describeMonthLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `В этом месяце задач и целей примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `на следующий месяц или разгрузить?${keepQ}`
  );
}

/** Собирает ёмкость+спрос МЕСЯЦА (задачи + недельные цели). */
export async function gatherMonthLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  const monthStart = localMonthStartUTC(tz, now);
  const monthEndExcl = localMonthStartUTC(tz, new Date(monthStart.getTime() + 32 * DAY_MS));
  const todayStart = localDayStartUTC(tz, now);

  const [tasks, weeklyGoals, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: { gte: monthStart, lt: monthEndExcl }, completed: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.weeklyGoal.findMany({
      where: { userId, weekStart: { gte: monthStart, lt: monthEndExcl }, completed: false, archivedAt: null },
      select: { goalText: true, estimatedMinutes: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: todayStart, lt: monthEndExcl } },
      select: { date: true, startTime: true, endTime: true },
    }),
  ]);

  const dayKey = (d: Date) => localDayStartUTC(tz, d).getTime();
  const evByDay = new Map<number, Array<{ startTime: string | null; endTime: string | null }>>();
  for (const e of events) {
    const k = dayKey(e.date);
    const arr = evByDay.get(k) ?? [];
    arr.push({ startTime: e.startTime, endTime: e.endTime });
    evByDay.set(k, arr);
  }

  const todayKey = todayStart.getTime();
  const days: Array<{ events: Array<{ startTime: string | null; endTime: string | null }>; isToday: boolean }> = [];
  for (let t = todayStart.getTime(); t < monthEndExcl.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    days.push({ events: evByDay.get(k) ?? [], isToday: k === todayKey });
  }

  const capacity = sumWeekCapacity(days, localTimeStr(tz, now));
  const items: CapacityItem[] = [
    ...tasks.map((t) => ({
      label: t.title,
      demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
      importance: t.importance ?? mapPriority(t.priority),
    })),
    ...weeklyGoals.map((g) => ({
      label: g.goalText,
      demand: g.estimatedMinutes ?? DEFAULT_GOAL_MINUTES,
      importance: GOAL_IMPORTANCE,
    })),
  ];
  return { capacity, items };
}

/** Реактивная строка «месяц перегружен». Best-effort, ≤1/день дедуп против СВОИХ. */
export async function maybeMonthLoadLine(userId: string, now: Date = new Date()): Promise<string | null> {
  if (!isV2MonthLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherMonthLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const seen = await prisma.insight.count({
      where: { userId, scopeKey: MONTH_LOAD_SCOPE, source: 'month_load', createdAt: { gte: dayStart } },
    });
    if (seen > 0) return null;

    const line = describeMonthLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: MONTH_LOAD_SCOPE, kind: 'month_load_reactive' },
          scopeKey: MONTH_LOAD_SCOPE,
          source: 'month_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[month-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: Green + tsc** — `cd packages/server && npx vitest run src/services/month-load.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/month-load.ts packages/server/src/services/month-load.test.ts && git commit -F - <<'EOF'
feat(engine): month-load adapter — gather/describe/maybeMonthLoadLine

Time-per-month on computeCapacityFit: demand = Σ this-month tasks + weekly
goals (estimatedMinutes ?? defaults), capacity = sumWeekCapacity over the
month's remaining days (tz-aware via localMonthStartUTC). Reactive overload
nudge, best-effort, ≤1/day dedup vs own source 'month_load'. Flag-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Каскад в `create_task` (day→week→month)

**Files:**
- Modify: `packages/server/src/tools/create-task.ts`
- Modify: `packages/server/src/tools/create-task-dayload.test.ts`

- [ ] **Step 1: Failing test** — добавить в `create-task-dayload.test.ts`:

```ts
  it('month-хук — третий уровень каскада (после дня и недели)', () => {
    expect(SRC).toContain('maybeMonthLoadLine');
    expect(SRC).toMatch(/dayLoad \|\| weekLoad \? null : await maybeMonthLoadLine/);
    expect(SRC).toMatch(/\?\? weekLoad \?\? monthLoad/);
  });
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/tools/create-task-dayload.test.ts` → FAIL.

- [ ] **Step 3a: Impl import** — в `create-task.ts` добавить рядом с `import { maybeWeekLoadLine } from '../services/week-load.js';`:

```ts
import { maybeMonthLoadLine } from '../services/month-load.js';
```

- [ ] **Step 3b: Impl cascade** — заменить блок:

```ts
    // #engine: день в приоритете; если день влезает — проверяем НЕДЕЛЮ.
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    const weekLoad = dayLoad ? null : await maybeWeekLoadLine(ctx.userId, new Date());
    const extra = dayLoad ?? weekLoad;
    return {
      message: extra ? `${message}\n\n${extra}` : message,
      taskId: task.id,
    };
```

на:

```ts
    // #engine: каскад горизонтов — показываем самый ближний перегруженный.
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    const weekLoad = dayLoad ? null : await maybeWeekLoadLine(ctx.userId, new Date());
    const monthLoad = dayLoad || weekLoad ? null : await maybeMonthLoadLine(ctx.userId, new Date());
    const extra = dayLoad ?? weekLoad ?? monthLoad;
    return {
      message: extra ? `${message}\n\n${extra}` : message,
      taskId: task.id,
    };
```

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/tools/create-task-dayload.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/create-task.ts packages/server/src/tools/create-task-dayload.test.ts && git commit -F - <<'EOF'
feat(engine): wire month-load into create_task cascade (day>week>month)

Third horizon: if day AND week fit, check the MONTH. At most one line,
nearest horizon wins. Flag-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Финальная сверка + независимое ревью

- [ ] **Step 1: Full suite + tsc** — `cd packages/server && npx vitest run && npx tsc --noEmit` → все зелёные (2150 + новые), 0.

- [ ] **Step 2: Изоляция** — деньги/день/неделя не изменены:

Run: `cd /Users/berikkurmangoliev/Desktop/LifeOS && git diff --name-only dbf3133..HEAD -- packages/server/src | grep -E "savings|day-load.ts$|week-load.ts$" || echo "(none touched — ок)"`
Expected: `(none touched — ок)` (day-load/week-load только импортируются, файлы не правим).

- [ ] **Step 3: Независимое ревью** (`superpowers:code-reviewer`) на диффе `dbf3133..HEAD`. Инварианты:
  - Флаг гейтит (сейчас =all); `maybeMonthLoadLine` best-effort try/catch→null, никогда не валит create_task.
  - Каскад: month проверяется ТОЛЬКО когда day И week оба null (`dayLoad || weekLoad ? null : ...`); максимум одна строка; нет двойного нуджа.
  - Границы месяца tz-aware (`localMonthStartUTC`), `monthEndExcl` эксклюзивно (`lt`); `+32*DAY_MS` гарантированно перешагивает месяц; capacity по оставшимся дням, demand по всему месяцу (консервативно).
  - Demand = задачи (estimatedMinutes ?? DEFAULT_TASK_MINUTES, importance ?? mapPriority) + недельные цели (estimatedMinutes ?? DEFAULT_GOAL_MINUTES, importance 2).
  - Дедуп vs own source `month_load`.
  - `sumWeekCapacity`/`computeCapacityFit`/`localMonthStartUTC` без NaN/negative.
  - Деньги/день/неделя не тронуты.

- [ ] **Step 4:** Память (observation + roadmap «срез МЕСЯЦ полностью done: data+нудж») + предложить деплой (флаг уже =all → push активирует).

---

## Self-Review (автор)

**Spec coverage:** §2.1 localMonthStartUTC→Task1; §2.2 gatherMonthLoad→Task2; §2.3 describeMonthLoad→Task2; §2.4 maybeMonthLoadLine→Task2; §2.5 каскад→Task3; §6 тесты→в каждой; §7 инварианты→Task4 ревью.

**Placeholders:** нет. Все code-блоки полные.

**Type consistency:** `localMonthStartUTC(tz, at)` определён Task1, использован Task2. `describeMonthLoad(fit: CapacityFit)` / `gatherMonthLoad(userId, now)` / `maybeMonthLoadLine(userId, now)` — едины Task2↔Task3. Импорты: `mapPriority`/`DEFAULT_TASK_MINUTES` из day-load, `DEFAULT_GOAL_MINUTES` из estimate-goal-minutes, `sumWeekCapacity` из _slots, `computeCapacityFit`/`CapacityFit`/`CapacityItem` из capacity-fit, `isV2MonthLoadEnabled` из feature-flags — все существуют (проверено в проде). Каскад `dayLoad ?? weekLoad ?? monthLoad` — `monthLoad` объявлен строкой выше. Базовая ревизия изоляции-grep = `dbf3133`.
