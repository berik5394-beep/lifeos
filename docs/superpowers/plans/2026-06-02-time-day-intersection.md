# Intersection Engine — Slice 1: Day Overload (time-per-day) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот предупреждает «день перегружен» — когда сумма оценённого времени задач на сегодня превышает свободное время (календарь+окно), предлагает перенести менее важные и спрашивает «хватит ли времени?».

**Architecture:** Ресурсо-агностичное чистое ядро `computeCapacityFit` (ёмкость vs Σспрос → защити важные greedy по importance, остальное → overflow) + время-адаптер `day-load.ts` (спрос = Σ `Task.estimatedMinutes ?? 30` сегодня; ёмкость = `availableMinutesToday` из календаря). Реактивный хук в `create_task` (как `maybeSavingsCoachLine` у денег). ИИ оценивает время задачи фоном (haiku). Деньги не трогаем.

**Tech Stack:** packages/server, TypeScript strict, ESM NodeNext (`.js`), vitest (zero vi.mock), pure helpers + structural tests.

**Дисциплина:** test→red→impl→green→`npx tsc --noEmit`→commit на каждый шаг. Из `packages/server`. Commit heredoc + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Базовая сюита **2103** зелёная. Деньги-путь не трогать. Флаг `FEATURE_V2_DAY_LOAD` off = байт-в-байт.

---

## Файлы

- **Create** `src/services/capacity-fit.ts` (+test) — чистое ядро.
- **Modify** `src/tools/_slots.ts` (+test `_slots.test.ts` или новый) — +`availableMinutesToday`.
- **Create** `src/services/estimate-task-minutes.ts` (+test) — parseMinutes + haiku-оценка.
- **Modify** `src/lib/feature-flags.ts` — +`isV2DayLoadEnabled`.
- **Create** `src/services/day-load.ts` (+test) — mapPriority/describeDayLoad (pure) + gatherDayLoad/maybeDayLoadLine/estimateTaskMinutesInBackground (DB).
- **Modify** `src/tools/create-task.ts` — хук: фоновая оценка + maybeDayLoadLine.

---

## Task 1: Pure `computeCapacityFit` (CHECKPOINT)

**Files:**
- Create: `src/services/capacity-fit.ts`
- Test: `src/services/capacity-fit.test.ts`

- [ ] **Step 1: Failing test**

`src/services/capacity-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCapacityFit } from './capacity-fit.js';

const item = (label: string, demand: number, importance: number) => ({ label, demand, importance });

describe('computeCapacityFit — ёмкость vs спрос', () => {
  it('пусто → fits, нули', () => {
    const r = computeCapacityFit({ capacity: 300, items: [] });
    expect(r.status).toBe('fits');
    expect(r.totalDemand).toBe(0);
    expect(r.overBy).toBe(0);
  });
  it('спрос много меньше ёмкости → fits', () => {
    const r = computeCapacityFit({ capacity: 1000, items: [item('a', 120, 3), item('b', 60, 2)] });
    expect(r.status).toBe('fits');
    expect(r.totalDemand).toBe(180);
  });
  it('впритык (0.85·cap ≤ demand ≤ cap) → tight', () => {
    const r = computeCapacityFit({ capacity: 300, items: [item('a', 270, 2)] });
    expect(r.status).toBe('tight');
  });
  it('перегруз → overloaded, overBy, greedy по importance', () => {
    const r = computeCapacityFit({
      capacity: 240,
      items: [item('low', 90, 1), item('hi', 120, 3), item('mid', 60, 2)],
    });
    expect(r.status).toBe('overloaded');
    expect(r.overBy).toBe(30); // 270 − 240
    expect(r.fit.map((i) => i.label)).toEqual(['hi', 'mid']); // важные защищены
    expect(r.overflow.map((i) => i.label)).toEqual(['low']);
  });
  it('capacity ≤ 0 → всё overflow, overloaded', () => {
    const r = computeCapacityFit({ capacity: 0, items: [item('a', 30, 1)] });
    expect(r.status).toBe('overloaded');
    expect(r.overflow).toHaveLength(1);
    expect(r.fit).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/services/capacity-fit.test.ts`
Expected: FAIL — `computeCapacityFit` не определён.

- [ ] **Step 3: Implement**

`src/services/capacity-fit.ts`:

```ts
/**
 * Ресурсо-агностичное ядро движка пересечения: ёмкость ресурса vs сумма
 * спроса. Не влезает → защищаем важные (greedy по importance desc),
 * остальное → overflow (кандидаты на перенос/урезание). Та же форма, что
 * у денег (computePortfolioPace) — деньги сведём на это ядро позже.
 * Чистое, без БД/AI.
 */
export interface CapacityItem {
  label: string;
  demand: number; // в той же единице, что capacity (минуты/₸)
  importance: number; // больше = важнее
}
export interface CapacityFitInput {
  capacity: number;
  items: CapacityItem[];
}
export type CapacityStatus = 'fits' | 'tight' | 'overloaded';
export interface CapacityFit {
  status: CapacityStatus;
  capacity: number;
  totalDemand: number;
  overBy: number; // max(0, totalDemand − capacity)
  fit: CapacityItem[]; // влезают (по убыванию importance)
  overflow: CapacityItem[]; // не влезают
}

const TIGHT_FACTOR = 0.85;

export function computeCapacityFit(input: CapacityFitInput): CapacityFit {
  const { capacity, items } = input;
  const totalDemand = items.reduce((s, i) => s + i.demand, 0);
  const overBy = Math.max(0, totalDemand - capacity);

  const sorted = items.slice().sort((a, b) => b.importance - a.importance);
  const fit: CapacityItem[] = [];
  const overflow: CapacityItem[] = [];
  let used = 0;
  for (const it of sorted) {
    if (capacity > 0 && used + it.demand <= capacity) {
      fit.push(it);
      used += it.demand;
    } else {
      overflow.push(it);
    }
  }

  let status: CapacityStatus;
  if (totalDemand > capacity) status = 'overloaded';
  else if (capacity > 0 && totalDemand >= TIGHT_FACTOR * capacity) status = 'tight';
  else status = 'fits';

  return { status, capacity, totalDemand, overBy, fit, overflow };
}
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/services/capacity-fit.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit (CHECKPOINT)**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/capacity-fit.ts packages/server/src/services/capacity-fit.test.ts && git commit -F - <<'EOF'
feat(engine): pure computeCapacityFit — resource-agnostic capacity vs demand

Core of the general intersection engine: capacity vs Σdemand → protect the
important (greedy by importance), rest → overflow (move candidates). Same
shape as the money coach; money will converge onto it later. 5 unit tests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Pure `availableMinutesToday`

**Files:**
- Modify: `src/tools/_slots.ts`
- Test: `src/tools/_slots.test.ts` (create if absent)

- [ ] **Step 1: Failing test**

Создать/дополнить `src/tools/_slots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { availableMinutesToday } from './_slots.js';

const ev = (startTime: string, endTime: string) => ({ startTime, endTime });

describe('availableMinutesToday — свободные минуты сегодня', () => {
  it('нет событий, сейчас 09:00 → полное окно 09:00–20:00 = 660', () => {
    expect(availableMinutesToday([], '09:00')).toBe(660);
  });
  it('сейчас 18:00, нет событий → 120', () => {
    expect(availableMinutesToday([], '18:00')).toBe(120);
  });
  it('встреча 14:00–15:00, сейчас 09:00 → 600', () => {
    expect(availableMinutesToday([ev('14:00', '15:00')], '09:00')).toBe(600);
  });
  it('прошедшее событие игнорируется (10:00–11:00, сейчас 12:00) → 480', () => {
    expect(availableMinutesToday([ev('10:00', '11:00')], '12:00')).toBe(480);
  });
  it('после окна (21:00) → 0', () => {
    expect(availableMinutesToday([], '21:00')).toBe(0);
  });
  it('событие частично до «сейчас» (11:30–13:00, сейчас 12:00) → урезается до 12:00–13:00', () => {
    // окно 12:00–20:00 = 480; минус 12:00–13:00 (60) = 420
    expect(availableMinutesToday([ev('11:30', '13:00')], '12:00')).toBe(420);
  });
});
```

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/tools/_slots.test.ts`
Expected: FAIL — `availableMinutesToday` не экспортирован.

- [ ] **Step 3: Implement**

В конец `src/tools/_slots.ts` добавить (использует существующий `timeDiff`):

```ts
/**
 * Свободные минуты СЕГОДНЯ от max(окно-старт, «сейчас») до окна-конца,
 * минус события (HH:MM). События — только сегодняшние (фильтрует вызывающий).
 * Окно 09:00–20:00 по дефолту (как findFreeSlots). Чистое.
 */
export function availableMinutesToday(
  events: Array<{ startTime: string | null; endTime: string | null }>,
  nowHHMM: string,
  windowStart = '09:00',
  windowEnd = '20:00',
): number {
  const start = nowHHMM > windowStart ? nowHHMM : windowStart;
  if (start >= windowEnd) return 0;
  const evs = events
    .filter((e) => e.startTime && e.endTime && e.endTime > start && e.startTime < windowEnd)
    .map((e) => ({
      s: (e.startTime as string) < start ? start : (e.startTime as string),
      e: (e.endTime as string) > windowEnd ? windowEnd : (e.endTime as string),
    }))
    .sort((a, b) => a.s.localeCompare(b.s));
  let free = 0;
  let cursor = start;
  for (const e of evs) {
    if (e.s > cursor) free += timeDiff(cursor, e.s);
    if (e.e > cursor) cursor = e.e;
  }
  if (cursor < windowEnd) free += timeDiff(cursor, windowEnd);
  return free;
}
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/tools/_slots.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/_slots.ts packages/server/src/tools/_slots.test.ts && git commit -F - <<'EOF'
feat(engine): pure availableMinutesToday — capacity from calendar+window

Free minutes today from max(window-start, now) to window-end minus events.
Reuses timeDiff; window 09:00–20:00 default. The time-resource capacity. 6 unit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `estimate-task-minutes.ts` (parseMinutes + haiku)

**Files:**
- Create: `src/services/estimate-task-minutes.ts`
- Test: `src/services/estimate-task-minutes.test.ts`

- [ ] **Step 1: Failing test (pure parseMinutes)**

`src/services/estimate-task-minutes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMinutes } from './estimate-task-minutes.js';

describe('parseMinutes — парс ответа haiku', () => {
  it('чистое число', () => expect(parseMinutes('90')).toBe(90));
  it('число со словами', () => expect(parseMinutes('примерно 120 минут')).toBe(120));
  it('меньше 5 → клампим к 5', () => expect(parseMinutes('3')).toBe(5));
  it('больше 480 → клампим к 480', () => expect(parseMinutes('5000')).toBe(480));
  it('мусор → дефолт 30', () => expect(parseMinutes('не знаю')).toBe(30));
  it('пусто → дефолт 30', () => expect(parseMinutes('')).toBe(30));
});
```

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/services/estimate-task-minutes.test.ts`
Expected: FAIL — `parseMinutes` не определён.

- [ ] **Step 3: Implement**

`src/services/estimate-task-minutes.ts`:

```ts
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

/** Достаёт минуты из ответа модели, клампит, дефолт при отсутствии. Чистая. */
export function parseMinutes(text: string): number {
  const m = text.match(/\d+/);
  if (!m) return DEFAULT_MINUTES;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
}

/**
 * Оценка времени задачи (минуты) — «сколько среднему человеку надо».
 * Best-effort haiku; на любой сбой → DEFAULT_MINUTES. Без БД.
 */
export async function estimateTaskMinutes(
  title: string,
  category: string | null,
): Promise<number> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return DEFAULT_MINUTES;
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 16,
      system:
        'Оцени, сколько МИНУТ среднему человеку нужно на задачу. ' +
        'Верни ТОЛЬКО целое число минут, без слов.',
      messages: [
        { role: 'user', content: `Задача: «${title}»${category ? ` (${category})` : ''}` },
      ],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? parseMinutes(block.text) : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/services/estimate-task-minutes.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/estimate-task-minutes.ts packages/server/src/services/estimate-task-minutes.test.ts && git commit -F - <<'EOF'
feat(engine): estimate-task-minutes — AI time estimate (haiku) + parseMinutes

AI estimates how long an average person needs for a task; pure parseMinutes
clamps 5..480, default 30 on failure. Best-effort, never throws. 6 unit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: `isV2DayLoadEnabled` flag

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Test: `src/lib/feature-flags.test.ts` (append if exists, else structural in day-load test)

- [ ] **Step 1: Failing test**

В `src/lib/feature-flags.test.ts` (если есть — добавить; если нет, пропустить шаг и проверить структурно в Task 5). Добавить:

```ts
import { isV2DayLoadEnabled } from './feature-flags.js';

describe('isV2DayLoadEnabled', () => {
  const prev = process.env.FEATURE_V2_DAY_LOAD;
  afterAll(() => { process.env.FEATURE_V2_DAY_LOAD = prev; });
  it('off по умолчанию', () => {
    delete process.env.FEATURE_V2_DAY_LOAD;
    expect(isV2DayLoadEnabled('u1')).toBe(false);
  });
  it('all → включено', () => {
    process.env.FEATURE_V2_DAY_LOAD = 'all';
    expect(isV2DayLoadEnabled('u1')).toBe(true);
  });
});
```

(Если файла нет — добавить `import { describe, it, expect, afterAll } from 'vitest';` сверху нового файла.)

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts`
Expected: FAIL — `isV2DayLoadEnabled` не определён.

- [ ] **Step 3: Implement**

В `src/lib/feature-flags.ts` после `isV2SavingsCoachEnabled` (или рядом с сиблингами) добавить:

```ts
export function isV2DayLoadEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_DAY_LOAD, userId);
}
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts && git commit -F - <<'EOF'
feat(engine): isV2DayLoadEnabled flag (FEATURE_V2_DAY_LOAD)

Gates the day-overload slice; same 'all'/user-X shape as siblings. Off =
byte-identical.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: `day-load.ts` — адаптер + хук

**Files:**
- Create: `src/services/day-load.ts`
- Test: `src/services/day-load.test.ts`

- [ ] **Step 1: Failing test (pure describeDayLoad + mapPriority + structural)**

`src/services/day-load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeDayLoad, mapPriority } from './day-load.js';
import { computeCapacityFit } from './capacity-fit.js';

describe('mapPriority', () => {
  it('high/critical→3, medium→2, low→1', () => {
    expect(mapPriority('critical')).toBe(3);
    expect(mapPriority('high')).toBe(3);
    expect(mapPriority('medium')).toBe(2);
    expect(mapPriority('low')).toBe(1);
  });
});

describe('describeDayLoad', () => {
  it('overloaded → строка с переносом + вопросом', () => {
    const fit = computeCapacityFit({
      capacity: 240,
      items: [
        { label: 'отчёт', demand: 120, importance: 3 },
        { label: 'звонок', demand: 60, importance: 2 },
        { label: 'почитать', demand: 90, importance: 1 },
      ],
    });
    const s = describeDayLoad(fit)!;
    expect(s).toContain('не всё влезет');
    expect(s).toContain('почитать'); // overflow → перенести
    expect(s).toContain('хватит ли времени');
  });
  it('fits → null (молчим)', () => {
    const fit = computeCapacityFit({ capacity: 1000, items: [{ label: 'a', demand: 30, importance: 1 }] });
    expect(describeDayLoad(fit)).toBeNull();
  });
});

describe('day-load — проводка хука (structural)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/services/day-load.ts'), 'utf-8');
  it('maybeDayLoadLine: флаг + gather + fit + дедуп против СВОИХ', () => {
    expect(SRC).toContain('isV2DayLoadEnabled');
    expect(SRC).toContain('computeCapacityFit');
    expect(SRC).toMatch(/count\([\s\S]*?source: 'day_load'[\s\S]*?gte: dayStart/);
    expect(SRC).toContain("'time:day_load'");
  });
  it('gatherDayLoad: estimatedMinutes ?? дефолт + availableMinutesToday', () => {
    expect(SRC).toContain('estimatedMinutes ??');
    expect(SRC).toContain('availableMinutesToday');
  });
});
```

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/services/day-load.test.ts`
Expected: FAIL — `day-load.ts` нет.

- [ ] **Step 3: Implement**

`src/services/day-load.ts`:

```ts
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localTimeStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2DayLoadEnabled } from '../lib/feature-flags.js';
import { availableMinutesToday } from '../tools/_slots.js';
import {
  computeCapacityFit,
  type CapacityFit,
  type CapacityItem,
} from './capacity-fit.js';
import { estimateTaskMinutes } from './estimate-task-minutes.js';

const DEFAULT_TASK_MINUTES = 30;
const DAY_LOAD_SCOPE = 'time:day_load';

/** priority-строка → числовая важность (для защиты важных задач). */
export function mapPriority(priority: string): number {
  if (priority === 'critical' || priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

/** Человеческая строка о перегрузе дня. null если влезает (молчим). */
export function describeDayLoad(fit: CapacityFit): string | null {
  if (fit.status !== 'overloaded' || fit.overflow.length === 0) return null;
  const h = (m: number) => Math.round(m / 60);
  const over = fit.overflow[0].label;
  const more = fit.overflow.length > 1 ? ` (и ещё ${fit.overflow.length - 1})` : '';
  const keep = fit.fit[0]?.label;
  const keepQ = keep ? ` И хватит ли времени на «${keep}»?` : '';
  return (
    `На сегодня задач примерно на ~${h(fit.totalDemand)}ч, а свободного ` +
    `времени ~${h(fit.capacity)}ч — не всё влезет. Перенести «${over}»${more} ` +
    `на завтра?${keepQ}`
  );
}

/** Собирает ёмкость+спрос дня из БД (спрос = estimatedMinutes ?? дефолт). */
export async function gatherDayLoad(
  userId: string,
  now: Date,
): Promise<{ capacity: number; items: CapacityItem[] }> {
  const tz = await getUserTimezone(userId);
  const today = localDayStartUTC(tz, now);
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, completed: false },
      select: { title: true, estimatedMinutes: true, importance: true, priority: true },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today },
      select: { startTime: true, endTime: true },
    }),
  ]);
  const capacity = availableMinutesToday(events, localTimeStr(tz, now));
  const items: CapacityItem[] = tasks.map((t) => ({
    label: t.title,
    demand: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
    importance: t.importance ?? mapPriority(t.priority),
  }));
  return { capacity, items };
}

/**
 * Реактивная строка после добавления задачи: день перегружен? Best-effort
 * (→null), гейт только overloaded, дедуп ≤1/день против СВОИХ
 * (source 'day_load' — урок бага денег). Зеркало maybeSavingsCoachLine.
 */
export async function maybeDayLoadLine(
  userId: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isV2DayLoadEnabled(userId)) return null;
  try {
    const { capacity, items } = await gatherDayLoad(userId, now);
    const fit = computeCapacityFit({ capacity, items });
    if (fit.status !== 'overloaded') return null;

    const tz = await getUserTimezone(userId);
    const dayStart = localDayStartUTC(tz, now);
    const coachedToday = await prisma.insight.count({
      where: { userId, scopeKey: DAY_LOAD_SCOPE, source: 'day_load', createdAt: { gte: dayStart } },
    });
    if (coachedToday > 0) return null;

    const line = describeDayLoad(fit);
    if (!line) return null;

    await prisma.insight
      .create({
        data: {
          userId,
          severity: 5,
          scope: { key: DAY_LOAD_SCOPE, kind: 'day_load_reactive' },
          scopeKey: DAY_LOAD_SCOPE,
          source: 'day_load',
          message: line,
          deliveredAt: now,
        },
      })
      .catch(() => {});
    return line;
  } catch (err) {
    console.warn('[day-load] non-fatal:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Фоновая оценка времени задачи (только если ещё не задана). Гейт флагом.
 * Fire-and-forget — не блокирует ответ create_task.
 */
export async function estimateTaskMinutesInBackground(
  taskId: string,
  title: string,
  category: string | null,
  userId: string,
): Promise<void> {
  if (!isV2DayLoadEnabled(userId)) return;
  try {
    const minutes = await estimateTaskMinutes(title, category);
    await prisma.task.updateMany({
      where: { id: taskId, estimatedMinutes: null },
      data: { estimatedMinutes: minutes },
    });
  } catch {
    /* best-effort */
  }
}
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/services/day-load.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/services/day-load.ts packages/server/src/services/day-load.test.ts && git commit -F - <<'EOF'
feat(engine): day-load adapter — gather/describe/maybeDayLoadLine + bg estimate

Time-per-day adapter over computeCapacityFit: demand = Σ task estimatedMinutes
(?? 30 default so it works before AI estimate lands), capacity =
availableMinutesToday. maybeDayLoadLine = reactive overload nudge (best-effort,
≤1/day dedup vs own source 'day_load'). estimateTaskMinutesInBackground fills
the estimate without blocking. Flag-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Хук в `create_task`

**Files:**
- Modify: `src/tools/create-task.ts`
- Test: `src/tools/create-task-dayload.test.ts` (structural)

- [ ] **Step 1: Failing structural test**

`src/tools/create-task-dayload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/tools/create-task.ts'), 'utf-8');

describe('create_task — хук движка пересечения (день)', () => {
  it('фоновая оценка времени задачи', () => {
    expect(SRC).toContain('estimateTaskMinutesInBackground');
  });
  it('реактивная строка «день перегружен» дописывается к ответу', () => {
    expect(SRC).toContain('maybeDayLoadLine');
    expect(SRC).toMatch(/maybeDayLoadLine[\s\S]*?message/);
  });
});
```

- [ ] **Step 2: Red**

Run: `cd packages/server && npx vitest run src/tools/create-task-dayload.test.ts`
Expected: FAIL — хука нет.

- [ ] **Step 3: Implement**

В `src/tools/create-task.ts` добавить импорт после строки 5 (`import { defineTool } ...`):

```ts
import {
  estimateTaskMinutesInBackground,
  maybeDayLoadLine,
} from '../services/day-load.js';
```

Заменить `return {...}` (строки 49-54) на:

```ts
    const message = `Задача "${input.title}" создана на ${input.date}${
      input.time ? ' в ' + input.time : ''
    }`;
    // #engine slice1: фоновая ИИ-оценка времени задачи (для точности дня,
    // не блокирует) + реактивная строка «день перегружен». Оба гейтнуты
    // флагом FEATURE_V2_DAY_LOAD внутри (off → message байт-в-байт).
    void estimateTaskMinutesInBackground(
      task.id,
      input.title,
      input.category ?? null,
      ctx.userId,
    );
    const dayLoad = await maybeDayLoadLine(ctx.userId, new Date());
    return {
      message: dayLoad ? `${message}\n\n${dayLoad}` : message,
      taskId: task.id,
    };
```

- [ ] **Step 4: Green + tsc**

Run: `cd packages/server && npx vitest run src/tools/create-task-dayload.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/berikkurmangoliev/Desktop/LifeOS && git add packages/server/src/tools/create-task.ts packages/server/src/tools/create-task-dayload.test.ts && git commit -F - <<'EOF'
feat(engine): wire day-load into create_task (bg estimate + overload nudge)

After creating a task: fire-and-forget AI time-estimate (refines the day's
accuracy, non-blocking) + maybeDayLoadLine appended to the reply when today is
overloaded. Both flag-gated → off is byte-identical.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Финальная сверка + независимое ревью

**Files:** (нет правок кода)

- [ ] **Step 1: Полная сюита + tsc**

Run: `cd packages/server && npx vitest run && npx tsc --noEmit`
Expected: все зелёные (2103 + новые), tsc 0.

- [ ] **Step 2: Деньги не тронуты**

Run: `cd packages/server && git diff --name-only 9f5f4ef..HEAD -- packages/server/src | grep -E "savings|portfolio" || echo "money path untouched"`
Expected: `money path untouched`.

- [ ] **Step 3: Независимое ревью**

Dispatch `superpowers:code-reviewer` на диффе Task 1-6 против спеки. Инварианты: (1) флаг-off байт-в-байт (create_task ответ без флага = прежний); (2) best-effort — maybeDayLoadLine/estimate никогда не роняют create_task (try/catch→null, void fire-and-forget); (3) дедуп ≤1/день против source 'day_load' (не глушится чужим); (4) computeCapacityFit: greedy защищает важные, overBy верный, capacity≤0→overloaded, без NaN; (5) availableMinutesToday не уходит в минус, прошедшее исключено; (6) деньги не тронуты; (7) gatherDayLoad: estimatedMinutes??default так что работает до оценки. Исправить, повторить до APPROVED.

- [ ] **Step 4: Память + предложить деплой**

Дописать в `remediation_plan_2026_06.md` (или interconnection_map.md) статус «Движок пересечения срез 1 (день) — реализован, ждёт пуш/деплой» + предложить «пуш и деплой» (флаг FEATURE_V2_DAY_LOAD выставить после).

---

## Self-Review (выполнено автором)

**1. Spec coverage:** §3 ядро→Task1; §4 адаптер (спрос/ёмкость/строка)→Task2(availableMinutesToday)+Task5(gather/describe); §5 ИИ-оценка→Task3+Task5(bg); §6 подача реактив+дедуп→Task5(maybeDayLoadLine)+Task6(хук); §7 флаг/без миграции→Task4 (миграции нет — estimatedMinutes есть); §8 деньги не трогаем→Task7 grep; §10 тесты→каждая задача.

**2. Placeholder scan:** нет TBD/«handle edge cases» — весь код приведён. Task4 условен (файл флагов-теста может отсутствовать) — указан фолбэк (структурно в Task5).

**3. Type consistency:** `CapacityItem{label,demand,importance}`/`CapacityFit{status,capacity,totalDemand,overBy,fit,overflow}` (Task1) используются в day-load (Task5) теми же именами. `availableMinutesToday(events{startTime,endTime}, nowHHMM)` (Task2) ← gatherDayLoad передаёт `{startTime,endTime}` + `localTimeStr`. `maybeDayLoadLine(userId, now)`/`estimateTaskMinutesInBackground(taskId,title,category,userId)` (Task5) ← create_task зовёт с теми же арг (Task6). `mapPriority(priority:string):number`, `estimatedMinutes ?? 30`. Дедуп `source:'day_load'` консистентен.

---

## Execution Handoff

После сохранения — выбор (Subagent-Driven / Inline executing-plans). Безопасность: push/deploy/флаг ТОЛЬКО по явному «пуш и деплой»; без миграции. Флаг `FEATURE_V2_DAY_LOAD` выставить ПОСЛЕ деплоя (по слову Berik). SMOKE: при `=all` добавить ботом 6 задач на сегодня → строка «день перегружен».
