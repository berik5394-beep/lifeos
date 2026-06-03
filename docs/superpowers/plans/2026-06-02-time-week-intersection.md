# Intersection Engine — Slice 2: Week Overload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Бот предупреждает «неделя перегружена» — когда Σ оценённого времени задач недели превышает свободное время недели; день в приоритете (если перегружен день — показываем день, иначе неделю).

**Architecture:** Тот же `computeCapacityFit`. Ёмкость недели = Σ дневной свободной ёмкости по оставшимся дням (reuse `availableMinutesToday`). Спрос = задачи этой недели. Реактив в `create_task` после дня (day-priority). Деньги/день не трогаем.

**Tech Stack:** packages/server, strict TS, vitest zero vi.mock, pure helpers + structural.

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit. Из `packages/server`. heredoc + Co-Authored-By. Базовая сюита **2129** зелёная. Флаг off = байт-в-байт.

---

## Task 1: Pure `sumWeekCapacity` (_slots.ts)

**Files:** Modify `src/tools/_slots.ts`; Test `src/tools/_slots.test.ts`

- [ ] **Step 1: Failing test** — добавить в `_slots.test.ts`:

```ts
import { sumWeekCapacity } from './_slots.js';

describe('sumWeekCapacity — ёмкость недели (сумма дней)', () => {
  it('сегодня от 18:00 + 2 полных будущих дня (нет событий)', () => {
    // today: availableMinutesToday([], '18:00') = 120; future: 660 each
    expect(sumWeekCapacity([
      { events: [], isToday: true },
      { events: [], isToday: false },
      { events: [], isToday: false },
    ], '18:00')).toBe(120 + 660 + 660);
  });
  it('событие на будущем дне вычитается', () => {
    expect(sumWeekCapacity([
      { events: [], isToday: true },
      { events: [{ startTime: '14:00', endTime: '15:00' }], isToday: false },
    ], '09:00')).toBe(660 + 600);
  });
  it('пусто → 0', () => {
    expect(sumWeekCapacity([], '09:00')).toBe(0);
  });
});
```

- [ ] **Step 2: Red** — `cd packages/server && npx vitest run src/tools/_slots.test.ts` → FAIL.

- [ ] **Step 3: Impl** — в конец `_slots.ts`:

```ts
/**
 * Ёмкость недели = Σ дневной свободной ёмкости по дням. Сегодня — от
 * «сейчас» (nowHHMM), будущие дни — полное окно ('00:00' → старт окна).
 * Переиспользует availableMinutesToday. Чистое.
 */
export function sumWeekCapacity(
  days: Array<{ events: Array<{ startTime: string | null; endTime: string | null }>; isToday: boolean }>,
  nowHHMM: string,
): number {
  return days.reduce(
    (s, d) => s + availableMinutesToday(d.events, d.isToday ? nowHHMM : '00:00'),
    0,
  );
}
```

- [ ] **Step 4: Green + tsc** — `npx vitest run src/tools/_slots.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/_slots.ts packages/server/src/tools/_slots.test.ts && git commit -F - <<'EOF'
feat(engine): pure sumWeekCapacity — week free time = Σ daily windows

Sums availableMinutesToday over the week's remaining days (today from now,
future days full window). 3 unit. Reuses the day primitive.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Export `DEFAULT_TASK_MINUTES` from day-load

**Files:** Modify `src/services/day-load.ts:13`

- [ ] **Step 1: Impl** — заменить `const DEFAULT_TASK_MINUTES = 30;` на `export const DEFAULT_TASK_MINUTES = 30;`

- [ ] **Step 2: tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/day-load.ts && git commit -F - <<'EOF'
refactor(engine): export DEFAULT_TASK_MINUTES for week-load reuse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `isV2WeekLoadEnabled` flag

**Files:** Modify `src/lib/feature-flags.ts`, `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Test** — в `feature-flags.test.ts` добавить `isV2WeekLoadEnabled` к импорту и describe (зеркало isV2DayLoadEnabled):

```ts
describe('isV2WeekLoadEnabled', () => {
  const ORIG = process.env.FEATURE_V2_WEEK_LOAD;
  afterEach(() => { if (ORIG === undefined) delete process.env.FEATURE_V2_WEEK_LOAD; else process.env.FEATURE_V2_WEEK_LOAD = ORIG; });
  it('off по умолчанию', () => { delete process.env.FEATURE_V2_WEEK_LOAD; expect(isV2WeekLoadEnabled('u1')).toBe(false); });
  it('all → включено', () => { process.env.FEATURE_V2_WEEK_LOAD = 'all'; expect(isV2WeekLoadEnabled('u1')).toBe(true); });
});
```

- [ ] **Step 2: Red** — `npx vitest run src/lib/feature-flags.test.ts` → FAIL.

- [ ] **Step 3: Impl** — после `isV2DayLoadEnabled` в `feature-flags.ts`:

```ts
export function isV2WeekLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_WEEK_LOAD, userId);
}
```

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -F - <<'EOF'
feat(engine): isV2WeekLoadEnabled flag (FEATURE_V2_WEEK_LOAD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: `week-load.ts` — адаптер + хук

**Files:** Create `src/services/week-load.ts`, `src/services/week-load.test.ts`

- [ ] **Step 1: Failing test** — `week-load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWeekLoad } from './week-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('describeWeekLoad', () => {
  it('overloaded → строка с «разнести по дням» + overflow + вопрос', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'почитать', demand: 90, importance: 1 },
      ],
    });
    const s = describeWeekLoad(fit)!;
    expect(s).toContain('На этой неделе');
    expect(s).toContain('почитать');
    expect(s).toContain('разнести по дням');
  });
  it('fits → null', () => {
    expect(describeWeekLoad(computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] }))).toBeNull();
  });
});

describe('week-load — проводка (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/week-load.ts'), 'utf-8');
  it('maybeWeekLoadLine: флаг + fit + дедуп против СВОИХ time:week_load', () => {
    expect(SRC).toContain('isV2WeekLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'week_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:week_load'");
  });
  it('gatherWeekLoad: задачи недели + sumWeekCapacity + границы недели (пн)', () => {
    expect(SRC).toContain('sumWeekCapacity');
    expect(SRC).toContain('localDayOfWeek');
    expect(SRC).toContain('estimatedMinutes ??');
  });
});
```

- [ ] **Step 2: Red** — `npx vitest run src/services/week-load.test.ts` → FAIL.

- [ ] **Step 3: Impl** — `src/services/week-load.ts`:

```ts
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localDayOfWeek, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2WeekLoadEnabled } from '../lib/feature-flags.js';
import { sumWeekCapacity } from '../tools/_slots.js';
import { computeCapacityFit, type CapacityFit, type CapacityItem } from './capacity-fit.js';
import { mapPriority, DEFAULT_TASK_MINUTES } from './day-load.js';

const DAY_MS = 86_400_000;
const WEEK_LOAD_SCOPE = 'time:week_load';

/** Строка о перегрузе недели. null если влезает. */
export function describeWeekLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `На этой неделе задач примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `или разнести по дням?${keepQ}`
  );
}

/** Собирает ёмкость+спрос НЕДЕЛИ (пн–вс локально). */
export async function gatherWeekLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  const todayStart = localDayStartUTC(tz, now);
  const daysFromMon = (localDayOfWeek(tz, now) + 6) % 7; // 0=Sun..6=Sat → Mon-offset
  const weekStart = new Date(todayStart.getTime() - daysFromMon * DAY_MS);
  const weekEndExcl = new Date(weekStart.getTime() + 7 * DAY_MS); // next Monday 00:00

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: { gte: weekStart, lt: weekEndExcl }, completed: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: todayStart, lt: weekEndExcl } },
      select: { date: true, startTime: true, endTime: true },
    }),
  ]);

  // События по локальному дню (нормализуем к local-day-start instant — устойчиво
  // к тому, как хранится CalendarEvent.date).
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
  for (let t = todayStart.getTime(); t < weekEndExcl.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    days.push({ events: evByDay.get(k) ?? [], isToday: k === todayKey });
  }

  const capacity = sumWeekCapacity(days, localTimeStr(tz, now));
  const items: CapacityItem[] = tasks.map((t) => ({
    label: t.title,
    demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
    importance: t.importance ?? mapPriority(t.priority),
  }));
  return { capacity, items };
}

/** Реактивная строка «неделя перегружена». Best-effort, ≤1/день дедуп против СВОИХ. */
export async function maybeWeekLoadLine(userId: string, now: Date = new Date()): Promise<string | null> {
  if (!isV2WeekLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherWeekLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const seen = await prisma.insight.count({
      where: { userId, scopeKey: WEEK_LOAD_SCOPE, source: 'week_load', createdAt: { gte: dayStart } },
    });
    if (seen > 0) return null;

    const line = describeWeekLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: WEEK_LOAD_SCOPE, kind: 'week_load_reactive' },
          scopeKey: WEEK_LOAD_SCOPE,
          source: 'week_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[week-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: Green + tsc** — `npx vitest run src/services/week-load.test.ts && npx tsc --noEmit` → PASS, 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/week-load.ts packages/server/src/services/week-load.test.ts && git commit -F - <<'EOF'
feat(engine): week-load adapter — gather/describe/maybeWeekLoadLine

Time-per-week on computeCapacityFit: demand = Σ this-week task estimatedMinutes,
capacity = sumWeekCapacity over remaining days (Mon–Sun, tz-aware). Reactive
overload nudge, best-effort, ≤1/day dedup vs own source 'week_load'. Reuses
mapPriority/DEFAULT_TASK_MINUTES + availableMinutesToday. Flag-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Wire into `create_task` (day-priority)

**Files:** Modify `src/tools/create-task.ts`, `src/tools/create-task-dayload.test.ts`

- [ ] **Step 1: Test** — добавить в `create-task-dayload.test.ts`:

```ts
it('week-хук после дня (день в приоритете)', () => {
  expect(SRC).toContain('maybeWeekLoadLine');
  expect(SRC).toMatch(/dayLoad \? null : await maybeWeekLoadLine/);
});
```

- [ ] **Step 2: Red** — `npx vitest run src/tools/create-task-dayload.test.ts` → FAIL.

- [ ] **Step 3: Impl** — в `create-task.ts` импорт `maybeWeekLoadLine` из `'../services/week-load.js'`; заменить блок дня:

```ts
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    return {
      message: dayLoad ? `${message}\n\n${dayLoad}` : message,
      taskId: task.id,
    };
```

на:

```ts
    // #engine: день в приоритете; если день влезает — проверяем НЕДЕЛЮ.
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    const extra = dayLoad ?? (await maybeWeekLoadLine(ctx.userId, new Date()));
    return {
      message: extra ? `${message}\n\n${extra}` : message,
      taskId: task.id,
    };
```

(Импорт: добавить `maybeWeekLoadLine` к существующему импорту из `'../services/day-load.js'`? Нет — week-load отдельный модуль; добавить строку `import { maybeWeekLoadLine } from '../services/week-load.js';`.)

- [ ] **Step 4: Green + tsc + commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS/packages/server && npx vitest run src/tools/create-task-dayload.test.ts && npx tsc --noEmit && cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/create-task.ts packages/server/src/tools/create-task-dayload.test.ts && git commit -F - <<'EOF'
feat(engine): wire week-load into create_task (day-priority)

After create: day-overload nudge first; if the day fits, check the WEEK
(maybeWeekLoadLine). At most one extra line, no double. Flag-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Финальная сверка + независимое ревью

- [ ] **Step 1:** `cd packages/server && npx vitest run && npx tsc --noEmit` → все зелёные (2129 + новые), 0.
- [ ] **Step 2:** money/day untouched: `git diff --name-only a4957d8..HEAD -- packages/server/src | grep -E "savings|portfolio|day-load.ts$"` → только day-load.ts (export-строка) ожидаемо; деньги нет.
- [ ] **Step 3:** Независимое ревью (`superpowers:code-reviewer`) на диффе. Инварианты: flag-off байт-в-байт (create_task без флага = прежний; week-хук null); never breaks create_task (best-effort); day-priority (не задвоится); week-границы пн–вс tz-aware (dayKey нормализует события; daysFromMon=(dow+6)%7); дедуп vs own source week_load; sumWeekCapacity/availableMinutesToday без NaN/negative; деньги не тронуты.
- [ ] **Step 4:** Память + предложить деплой (флаг FEATURE_V2_WEEK_LOAD выставить через тот же account-token+curl после).

---

## Self-Review (автор)

**Spec coverage:** §2 ёмкость→Task1(sumWeekCapacity)+Task4(gatherWeekLoad границы); спрос→Task4; §3 подача day-priority→Task5, дедуп→Task4; §4 флаг→Task3, без миграции→ничего; §5 reuse (mapPriority/DEFAULT export)→Task2; §6 тесты→каждая.
**Placeholders:** нет. **Type consistency:** `CapacityItem/CapacityFit` из capacity-fit; `sumWeekCapacity(days[{events,isToday}], nowHHMM)` (Task1) ← gatherWeekLoad строит days (Task4); `mapPriority`/`DEFAULT_TASK_MINUTES` экспортированы (Task2) и импортируются (Task4); `maybeWeekLoadLine(userId, now)` (Task4) ← create_task (Task5). Границы недели: `(localDayOfWeek+6)%7` (0=Sun..6=Sat → Mon-offset), `weekEndExcl` эксклюзивно (`lt`).
**TZ:** `dayKey = localDayStartUTC(tz, d)` нормализует и события, и дни → устойчиво к хранению CalendarEvent.date. Caveat DST: шаг 86.4M точен для no-DST tz (Almaty); приемлемо v1.

## Handoff
Inline executing-plans. Деньги/день не ломать. Флаг `FEATURE_V2_WEEK_LOAD` — после деплоя (account-token+curl, IDs в roadmap §6/interconnection_map).
