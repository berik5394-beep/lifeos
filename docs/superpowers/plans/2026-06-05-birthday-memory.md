# Память ДР (Birthday Memory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот помнит дни рождения людей и проактивно напоминает заранее («Завтра ДР у Ахмета (исполнится 30) — поздравишь?»), плюс отвечает на «у кого скоро ДР?».

**Architecture:** Хранение ДР в `Entity.attributes.birthday` (без миграции). Чистые хелперы дат (`services/birthday/types.ts`) + DB-гейтер (`services/birthday/birthday.ts`). Инструмент `set_birthday` пишет через `upsertEntity` (мержит attributes). Проактивный детектор `detectBirthday` (окно 1 день) и enrichment-врезка (окно 7 дней) — оба за флагом `isV2BirthdayEnabled`, OFF = байт-идентично.

**Tech Stack:** Fastify + Prisma 6 + Postgres, TypeScript strict (no `any`), ESM (`.js` импорты), vitest, zero `vi.mock`.

**Rollout:** Коммит на каждый шаг (heredoc, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). push / deploy / выставление флага — ТОЛЬКО по явному слову Berik. Money-safety: единственная запись — `Entity.attributes.birthday`; ноль денежных записей.

**Каждый шаг проверяй `npx tsc --noEmit` (из `packages/server`) — должно быть чисто.**

---

## File Structure

- Create `src/services/birthday/types.ts` — чистые хелперы дат + типы (юнит-тестируемы, без I/O).
- Create `src/services/birthday/types.test.ts` — pure-юнит-тесты хелперов.
- Create `src/services/birthday/birthday.ts` — DB-гейтер: чтение person-entities с ДР, сборка upcoming + enrichment-секции (read-only).
- Create `src/services/birthday/index.ts` — re-exports.
- Create `src/tools/set-birthday.ts` — инструмент `set_birthday` (defineTool, needsConfirm:false).
- Create `src/services/birthday/birthday.it.test.ts` — поведенческий тест на тест-БД.
- Create `src/services/birthday/birthday-wiring.test.ts` — структурный (grep) + money-safety.
- Modify `src/lib/feature-flags.ts` — `isV2BirthdayEnabled`.
- Modify `src/lib/feature-flags.test.ts` — юнит-кейс флага.
- Modify `src/tools/index.ts` — регистрация `setBirthdayTool` в `ALL_TOOLS`.
- Modify `src/services/v2-proactivity-engine.ts` — union + TEMPLATES + scoreSignificance + `detectBirthday` + регистрация.
- Modify `src/services/v2-enrichment.ts` — поле `birthdays` + gather-врезка за флагом + push в блок.

---

## Task 1: Флаг `isV2BirthdayEnabled`

**Files:**
- Modify: `src/lib/feature-flags.ts`
- Test: `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Добавь в `src/lib/feature-flags.test.ts` (рядом с тестами `isV2AxesEnabled`; импорт уже есть — допиши имя в существующий import-список из `./feature-flags.js`):

```ts
describe('isV2BirthdayEnabled', () => {
  const KEY = 'FEATURE_V2_BIRTHDAY';
  afterEach(() => { delete process.env[KEY]; });

  it('undefined env → false', () => {
    delete process.env[KEY];
    expect(isV2BirthdayEnabled('u1')).toBe(false);
  });
  it('"all" → true для любого', () => {
    process.env[KEY] = 'all';
    expect(isV2BirthdayEnabled('u1')).toBe(true);
  });
  it('"none"/"" → false', () => {
    process.env[KEY] = 'none';
    expect(isV2BirthdayEnabled('u1')).toBe(false);
    process.env[KEY] = '';
    expect(isV2BirthdayEnabled('u1')).toBe(false);
  });
  it('user-<id> → только адресно', () => {
    process.env[KEY] = 'user-u1,user-u2';
    expect(isV2BirthdayEnabled('u1')).toBe(true);
    expect(isV2BirthdayEnabled('u3')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t isV2BirthdayEnabled`
Expected: FAIL — `isV2BirthdayEnabled is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

В `src/lib/feature-flags.ts` добавь функцию (точная копия формы `isV2AxesEnabled`):

```ts
export function isV2BirthdayEnabled(userId: string): boolean {
  const raw = process.env.FEATURE_V2_BIRTHDAY;
  if (raw === undefined) return false;
  const flag = raw.trim();
  if (flag === '' || flag === 'none' || flag === 'false') return false;
  if (flag === 'all' || flag === 'true') return true;
  return flag.split(',').some((s) => s.trim() === `user-${userId}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/lib/feature-flags.test.ts -t isV2BirthdayEnabled`
Expected: PASS (4 теста). Затем `npx tsc --noEmit` — чисто.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/lib/feature-flags.ts packages/server/src/lib/feature-flags.test.ts
git commit -F - <<'EOF'
feat(birthday): isV2BirthdayEnabled feature flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Чистые хелперы дат — `services/birthday/types.ts`

**Files:**
- Create: `src/services/birthday/types.ts`
- Test: `src/services/birthday/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/birthday/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseBirthday,
  daysUntilBirthday,
  ageOnNextBirthday,
  whenLabel,
  ageSuffix,
  upcomingBirthdays,
  formatBirthdaySection,
  type Birthday,
  type PersonBirthdayRow,
} from './types.js';

describe('parseBirthday', () => {
  it('структурный объект {day,month,year}', () => {
    expect(parseBirthday({ day: 12, month: 5, year: 1994 })).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('структурный объект без года', () => {
    expect(parseBirthday({ day: 12, month: 5 })).toEqual({ day: 12, month: 5 });
  });
  it('русская строка «12 мая»', () => {
    expect(parseBirthday('12 мая')).toEqual({ day: 12, month: 5 });
  });
  it('русская строка с годом «12 мая 1994»', () => {
    expect(parseBirthday('12 мая 1994')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('русская строка в род. падеже «3 января»', () => {
    expect(parseBirthday('3 января')).toEqual({ day: 3, month: 1 });
  });
  it('числовая «12.05»', () => {
    expect(parseBirthday('12.05')).toEqual({ day: 12, month: 5 });
  });
  it('числовая «12.05.1994»', () => {
    expect(parseBirthday('12.05.1994')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('ISO «1994-05-12»', () => {
    expect(parseBirthday('1994-05-12')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('29 февраля — валидно (год невисокосный не важен)', () => {
    expect(parseBirthday('29.02')).toEqual({ day: 29, month: 2 });
  });
  it('31 апреля → null (в апреле 30 дней)', () => {
    expect(parseBirthday('31.04')).toBeNull();
  });
  it('месяц 13 → null', () => {
    expect(parseBirthday('05.13')).toBeNull();
  });
  it('мусор → null', () => {
    expect(parseBirthday('завтра как-нибудь')).toBeNull();
    expect(parseBirthday('')).toBeNull();
    expect(parseBirthday(null)).toBeNull();
    expect(parseBirthday(42)).toBeNull();
  });
  it('год вне 1900-2100 → null', () => {
    expect(parseBirthday('12.05.1850')).toBeNull();
  });
});

describe('daysUntilBirthday (UTC-детерминированно)', () => {
  it('сегодня → 0', () => {
    expect(daysUntilBirthday({ day: 5, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(0);
  });
  it('завтра → 1', () => {
    expect(daysUntilBirthday({ day: 6, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(1);
  });
  it('уже прошёл в этом году → считает на следующий год', () => {
    // 1 июня прошло; now 5 июня 2026 → next 1 июня 2027
    expect(daysUntilBirthday({ day: 1, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(361);
  });
  it('через границу года: ДР 3 янв при now 30 дек', () => {
    expect(daysUntilBirthday({ day: 3, month: 1 }, new Date('2026-12-30T00:00:00Z'))).toBe(4);
  });
  it('29 фев в невисокосный год → как 1 марта', () => {
    // 2027 невисокосный; now 27 фев 2027 → 1 марта = +2 дня
    expect(daysUntilBirthday({ day: 29, month: 2 }, new Date('2027-02-27T00:00:00Z'))).toBe(2);
  });
});

describe('ageOnNextBirthday', () => {
  it('без года → null', () => {
    expect(ageOnNextBirthday({ day: 12, month: 5 }, new Date('2026-06-05T00:00:00Z'))).toBeNull();
  });
  it('с годом, ДР ещё впереди в этом году', () => {
    // ДР 6 июня; now 5 июня 2026 → след. 6 июня 2026 → исполнится 2026-1994=32
    expect(ageOnNextBirthday({ day: 6, month: 6, year: 1994 }, new Date('2026-06-05T00:00:00Z'))).toBe(32);
  });
  it('с годом, ДР в этом году прошёл', () => {
    // ДР 1 июня; now 5 июня 2026 → след. 1 июня 2027 → 2027-1994=33
    expect(ageOnNextBirthday({ day: 1, month: 6, year: 1994 }, new Date('2026-06-05T00:00:00Z'))).toBe(33);
  });
});

describe('whenLabel / ageSuffix', () => {
  it('whenLabel', () => {
    expect(whenLabel(0)).toBe('сегодня');
    expect(whenLabel(1)).toBe('завтра');
    expect(whenLabel(3)).toBe('через 3 дн.');
  });
  it('ageSuffix', () => {
    expect(ageSuffix(null)).toBe('');
    expect(ageSuffix(30)).toBe(' (исполнится 30)');
  });
});

describe('upcomingBirthdays', () => {
  const persons: PersonBirthdayRow[] = [
    { entityId: 'e1', name: 'Серик', importance: 7, birthday: { day: 8, month: 6 } },
    { entityId: 'e2', name: 'Ахмет', importance: 9, birthday: { day: 6, month: 6, year: 1996 } },
    { entityId: 'e3', name: 'Далёкий', importance: 5, birthday: { day: 1, month: 12 } },
  ];
  it('фильтрует по окну и сортирует по daysUntil', () => {
    const out = upcomingBirthdays(persons, new Date('2026-06-05T00:00:00Z'), 7);
    expect(out.map((r) => r.name)).toEqual(['Ахмет', 'Серик']); // 1д, 3д; Далёкий вне окна
    expect(out[0]).toEqual({ entityId: 'e2', name: 'Ахмет', importance: 9, daysUntil: 1, age: 30 });
    expect(out[1].age).toBeNull();
  });
  it('пустой результат, если все вне окна', () => {
    expect(upcomingBirthdays(persons, new Date('2026-06-05T00:00:00Z'), 0)).toEqual([]);
  });
});

describe('formatBirthdaySection', () => {
  it('пусто → null', () => {
    expect(formatBirthdaySection([])).toBeNull();
  });
  it('форматирует строку', () => {
    const rows = [
      { entityId: 'e2', name: 'Ахмет', importance: 9, daysUntil: 1, age: 30 },
      { entityId: 'e1', name: 'Серик', importance: 7, daysUntil: 3, age: null },
    ];
    expect(formatBirthdaySection(rows)).toBe('Скоро ДР: Ахмет — завтра; Серик — через 3 дн.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/services/birthday/types.test.ts`
Expected: FAIL — модуль `./types.js` не найден.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/birthday/types.ts`:

```ts
/**
 * Память ДР — чистые хелперы дат. Без I/O, не бросают (null/[]).
 * Все вычисления в UTC для детерминизма. 29 фев → 1 марта в невисокосный год.
 */

export interface Birthday {
  day: number;
  month: number;
  year?: number;
}

export interface PersonBirthdayRow {
  entityId: string;
  name: string;
  importance: number;
  birthday: Birthday;
}

export interface UpcomingBirthday {
  entityId: string;
  name: string;
  importance: number;
  daysUntil: number;
  age: number | null;
}

const DAY_MS = 86_400_000;

// Дней в месяце; февраль = 29, чтобы 29.02 проходило валидацию.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const RU_MONTHS: Record<string, number> = {
  январь: 1, января: 1, янв: 1,
  февраль: 2, февраля: 2, фев: 2,
  март: 3, марта: 3, мар: 3,
  апрель: 4, апреля: 4, апр: 4,
  май: 5, мая: 5,
  июнь: 6, июня: 6, июн: 6,
  июль: 7, июля: 7, июл: 7,
  август: 8, августа: 8, авг: 8,
  сентябрь: 9, сентября: 9, сен: 9, сент: 9,
  октябрь: 10, октября: 10, окт: 10,
  ноябрь: 11, ноября: 11, ноя: 11,
  декабрь: 12, декабря: 12, дек: 12,
};

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function validate(day: number, month: number, year?: number): Birthday | null {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  if (year !== undefined) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
    return { day, month, year };
  }
  return { day, month };
}

export function parseBirthday(input: unknown): Birthday | null {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.day === 'number' && typeof o.month === 'number') {
      return validate(o.day, o.month, typeof o.year === 'number' ? o.year : undefined);
    }
    return null;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === '') return null;

  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validate(Number(m[3]), Number(m[2]), Number(m[1]));

  // DD.MM[.YYYY] или DD/MM[/YYYY]
  m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  if (m) return validate(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);

  // «12 мая [1994]»
  m = s.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/);
  if (m) {
    const month = RU_MONTHS[m[2]];
    if (!month) return null;
    return validate(Number(m[1]), month, m[3] ? Number(m[3]) : undefined);
  }
  return null;
}

// UTC-полночь даты `now`.
function todayUTC(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// Целевая дата ДР в году y (29 фев → 1 мар в невисокосный).
function targetForYear(b: Birthday, y: number): number {
  if (b.month === 2 && b.day === 29 && !isLeap(y)) {
    return Date.UTC(y, 2, 1); // 1 марта
  }
  return Date.UTC(y, b.month - 1, b.day);
}

// Год ближайшего наступления ДР (этот год, если ещё не прошёл; иначе следующий).
function nextOccurrenceYear(b: Birthday, now: Date): number {
  const y = now.getUTCFullYear();
  return targetForYear(b, y) >= todayUTC(now) ? y : y + 1;
}

export function daysUntilBirthday(b: Birthday, now: Date): number {
  const t = targetForYear(b, nextOccurrenceYear(b, now));
  return Math.round((t - todayUTC(now)) / DAY_MS);
}

export function ageOnNextBirthday(b: Birthday, now: Date): number | null {
  if (b.year === undefined) return null;
  return nextOccurrenceYear(b, now) - b.year;
}

export function whenLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'сегодня';
  if (daysUntil === 1) return 'завтра';
  return `через ${daysUntil} дн.`;
}

export function ageSuffix(age: number | null): string {
  return age === null ? '' : ` (исполнится ${age})`;
}

export function upcomingBirthdays(
  persons: PersonBirthdayRow[],
  now: Date,
  windowDays: number,
): UpcomingBirthday[] {
  const out: UpcomingBirthday[] = [];
  for (const p of persons) {
    const daysUntil = daysUntilBirthday(p.birthday, now);
    if (daysUntil > windowDays) continue;
    out.push({
      entityId: p.entityId,
      name: p.name,
      importance: p.importance,
      daysUntil,
      age: ageOnNextBirthday(p.birthday, now),
    });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

export function formatBirthdaySection(rows: UpcomingBirthday[]): string | null {
  if (!rows || rows.length === 0) return null;
  const parts = rows.map((r) => `${r.name} — ${whenLabel(r.daysUntil)}`);
  return `Скоро ДР: ${parts.join('; ')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/services/birthday/types.test.ts`
Expected: PASS (все группы). Затем `npx tsc --noEmit` — чисто.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/birthday/types.ts packages/server/src/services/birthday/types.test.ts
git commit -F - <<'EOF'
feat(birthday): pure date helpers (parse/daysUntil/age/format)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: DB-гейтер — `services/birthday/birthday.ts` + `index.ts`

**Files:**
- Create: `src/services/birthday/birthday.ts`
- Create: `src/services/birthday/index.ts`

(Поведение этого файла проверяется поведенческим тестом в Task 6 — тут пишем код + tsc.)

- [ ] **Step 1: Write implementation — `birthday.ts`**

Create `src/services/birthday/birthday.ts`:

```ts
import { prisma } from '../../lib/prisma.js';
import {
  parseBirthday,
  upcomingBirthdays,
  formatBirthdaySection,
  type PersonBirthdayRow,
  type UpcomingBirthday,
} from './types.js';

/**
 * Память ДР — read-only гейтер. Читает person-сущности юзера, у которых
 * в attributes есть валидный birthday. Никаких записей.
 */
export async function listPersonBirthdays(userId: string): Promise<PersonBirthdayRow[]> {
  const rows = await prisma.entity.findMany({
    where: { userId, type: 'person' },
    select: { id: true, name: true, importance: true, attributes: true },
  });
  const out: PersonBirthdayRow[] = [];
  for (const r of rows) {
    const attrs = (r.attributes ?? {}) as Record<string, unknown>;
    const bday = parseBirthday(attrs.birthday);
    if (!bday) continue;
    out.push({ entityId: r.id, name: r.name, importance: r.importance, birthday: bday });
  }
  return out;
}

/** Ближайшие ДР в окне windowDays (для детектора и enrichment). */
export async function buildUpcomingBirthdays(
  userId: string,
  now: Date,
  windowDays: number,
): Promise<UpcomingBirthday[]> {
  const persons = await listPersonBirthdays(userId);
  return upcomingBirthdays(persons, now, windowDays);
}

/** Enrichment-секция «Скоро ДР: …» (окно 7 дней) или null. */
export async function buildBirthdaySection(userId: string): Promise<string | null> {
  const rows = await buildUpcomingBirthdays(userId, new Date(), 7);
  return formatBirthdaySection(rows);
}
```

- [ ] **Step 2: Write `index.ts`**

Create `src/services/birthday/index.ts`:

```ts
export * from './types.js';
export { listPersonBirthdays, buildUpcomingBirthdays, buildBirthdaySection } from './birthday.js';
```

- [ ] **Step 3: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/birthday/birthday.ts packages/server/src/services/birthday/index.ts
git commit -F - <<'EOF'
feat(birthday): read-only DB gatherer (listPersonBirthdays/upcoming/section)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Инструмент `set_birthday` + регистрация

**Files:**
- Create: `src/tools/set-birthday.ts`
- Modify: `src/tools/index.ts`
- Test: проверка регистрации — в структурном тесте Task 6; поведение записи — в `.it.test.ts` Task 6.

- [ ] **Step 1: Read the reference tool**

Run: `sed -n '1,45p' packages/server/src/tools/remember-entity.ts`
Убедись в форме `defineTool` (imporт `defineTool` из `./_types.js`, `getEntityGraph` из `../services/entity-graph/index.js`, поля name/description/category/aliases/schema/needsConfirm/sideEffects/examples/handler).

- [ ] **Step 2: Write implementation**

Create `src/tools/set-birthday.ts`:

```ts
import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';
import { parseBirthday } from '../services/birthday/types.js';

/**
 * Память ДР — agent-callable. Записывает день рождения человека в
 * Entity.attributes.birthday. upsertEntity мержит attributes (не затирает
 * прочие ключи). Reversible/idempotent на каноничном имени → needsConfirm:false.
 * Money-safety: пишет ТОЛЬКО память, ноль денег.
 */
export const setBirthdayTool = defineTool({
  name: 'set_birthday',
  description:
    'Запомнить день рождения человека. Вызывай когда юзер называет ДР — ' +
    'явно («запомни, у Ахмета ДР 12 мая») или вскользь («у Серика др завтра, ' +
    '8 июня»). Год опционален.',
  category: 'memory',
  aliases: { name: 'person', personName: 'person' },
  schema: z.object({
    person: z.string().min(1).max(120).describe('Имя человека, напр. «Ахмет»'),
    day: z.number().int().min(1).max(31).describe('День, напр. 12'),
    month: z.number().int().min(1).max(12).describe('Месяц числом 1-12, напр. 5 (май)'),
    year: z.number().int().min(1900).max(2100).optional().describe('Год рождения, если известен'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запомни у Ахмета ДР 12 мая', 'у Серика день рождения 8 июня'],
  handler: async (input, ctx) => {
    const bday = parseBirthday({ day: input.day, month: input.month, year: input.year });
    if (!bday) {
      return { message: 'Не понял дату ДР — проверь день и месяц.' };
    }
    const entity = await getEntityGraph().upsertEntity(ctx.userId, {
      type: 'person',
      name: input.person,
      attributes: { birthday: bday } as Record<string, unknown>,
      importance: 5,
    });
    const yearPart = bday.year ? `.${bday.year}` : '';
    return {
      message: `Запомнил: ДР ${input.person} — ${bday.day}.${bday.month}${yearPart}`,
      entityId: entity.id,
    };
  },
});
```

> ВНИМАНИЕ: точную форму `upsertEntity` (порядок аргументов, имя поля `attributes`/`importance`) досверь в `src/tools/remember-entity.ts` — она там идентична. Если `defineTool` требует иных опциональных полей (напр. отсутствует `examples`) — повтори ровно как у `remember-entity`/`link-relationship`.

- [ ] **Step 3: Register in `ALL_TOOLS`**

В `src/tools/index.ts`:
1. Добавь импорт рядом с другими tool-импортами:
   ```ts
   import { setBirthdayTool } from './set-birthday.js';
   ```
2. Добавь `setBirthdayTool` в массив `ALL_TOOLS` (рядом с `rememberEntityTool`/`linkRelationshipTool`).

Досверь точные имена: `grep -n "rememberEntityTool\|ALL_TOOLS" src/tools/index.ts`.

- [ ] **Step 4: Verify tsc + tool loads**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто.
Run: `cd packages/server && npx vitest run src/tools/ -t "registry" 2>/dev/null || npx tsc --noEmit`
Expected: существующие реестровые тесты (если есть) зелёные; load-time guard (needsConfirm boolean) не падает.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/set-birthday.ts packages/server/src/tools/index.ts
git commit -F - <<'EOF'
feat(birthday): set_birthday tool (needsConfirm:false, writes Entity.attributes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Проактивный детектор `detectBirthday`

**Files:**
- Modify: `src/services/v2-proactivity-engine.ts`

Порядок правок ниже важен: union → TEMPLATES → scoreSignificance заставят `tsc` ругаться, пока не добавишь все три (Record total + switch без default). Это и есть exhaustiveness-страховка.

- [ ] **Step 1: Add to `NudgeSource` union**

В `src/services/v2-proactivity-engine.ts`, в `export type NudgeSource = ... | 'decision_review';` добавь новый член:

```ts
  | 'decision_review'
  | 'birthday_upcoming';
```

- [ ] **Step 2: Add `TEMPLATES` entry**

В объект `TEMPLATES` добавь ключ (рядом с `decision_review`):

```ts
  birthday_upcoming: {
    gentle: '{{whenLabel}} ДР у {{name}}{{ageSuffix}} — поздравишь?',
    curious: 'У {{name}} {{whenLabel}} день рождения{{ageSuffix}}. Напомнить заранее?',
    supportive: '{{whenLabel}} ДР у {{name}}{{ageSuffix}}. Хороший повод написать тёплое слово!',
  },
```

- [ ] **Step 3: Add `scoreSignificance` case**

В `switch (c.source)` функции `scoreSignificance` добавь кейс (рядом с `decision_review`):

```ts
    case 'birthday_upcoming': {
      // ДР — стабильно значимо (≥0.6 floor gate3, чтобы доходило).
      // Сегодня/высокая важность → выше.
      const daysUntil = Number(c.payload.daysUntil ?? 1);
      const importance = Number(c.payload.importance ?? 5);
      const base = daysUntil <= 0 ? 0.8 : 0.65;
      return Math.min(1, base + (importance - 5) * 0.03);
    }
```

- [ ] **Step 4: Verify tsc fails on missing detector wiring is NOT yet relevant — but compile must pass after 1-3**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (union+TEMPLATES+score согласованы). Если ругается на отсутствующий ключ TEMPLATES или непокрытый case — допиши.

- [ ] **Step 5: Write `detectBirthday`**

Добавь функцию рядом с `detectRelationshipLink` (используй `DAY_MS`/паттерн уже в файле; импорты `getEntityGraph`/`prisma` уже есть — нужны хелперы из birthday):

В начало файла добавь импорт:
```ts
import { buildUpcomingBirthdays, whenLabel, ageSuffix } from './birthday/index.js';
```

Функция:
```ts
async function detectBirthday(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2BirthdayEnabled } = await import('../lib/feature-flags.js');
    if (!isV2BirthdayEnabled(userId)) return [];
    const rows = await buildUpcomingBirthdays(userId, new Date(), 1); // окно: завтра + сегодня
    const out: NudgeCandidate[] = [];
    for (const r of rows) {
      const cand: NudgeCandidate = {
        source: 'birthday_upcoming',
        significance: 0,
        entityId: r.entityId,
        payload: {
          name: r.name,
          daysUntil: r.daysUntil,
          age: r.age,
          importance: r.importance,
          whenLabel: whenLabel(r.daysUntil),
          ageSuffix: ageSuffix(r.age),
        },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectBirthday failed:', err);
    return [];
  }
}
```

- [ ] **Step 6: Register in `detectCandidates`**

В `Promise.allSettled([ ... ])` внутри `detectCandidates` добавь строку:
```ts
      detectBirthday(userId),
```
(рядом с `detectRelationshipLink(userId),`).

- [ ] **Step 7: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/v2-proactivity-engine.ts
git commit -F - <<'EOF'
feat(birthday): detectBirthday proactivity detector (flag-gated, window 1d)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Enrichment-врезка `birthdays`

**Files:**
- Modify: `src/services/v2-enrichment.ts`

- [ ] **Step 1: Add import**

Рядом с импортами cross-domain хелперов (`buildRelationshipNudge` и т.п.) добавь:
```ts
import { buildBirthdaySection } from './birthday/index.js';
```
И убедись, что `isV2BirthdayEnabled` импортируется из `../lib/feature-flags.js` (добавь в существующий import-список флагов).

- [ ] **Step 2: Add field to `V2EnrichmentData`**

В тип `V2EnrichmentData` рядом с `decisions: string | null;` добавь:
```ts
  /** Память ДР (мост #2): «Скоро ДР: …» или null. */
  birthdays: string | null;
```

- [ ] **Step 3: Push in `buildV2EnrichmentBlock`**

В функции `buildV2EnrichmentBlock`, после блока decisions (`if (dec) lines.push(dec);`) добавь:
```ts
  if (data.birthdays) lines.push(data.birthdays);
```
(секция уже самодостаточна — `buildBirthdaySection` отдаёт готовую строку «Скоро ДР: …».)

- [ ] **Step 4: Gather in the Promise.all**

В функции-гейтере (где `const [identity, ..., decisions] = await Promise.all([...])`):
1. Добавь `birthdays` в деструктуризацию: `..., decisions, birthdays] = await Promise.all([`.
2. Добавь соответствующий элемент в КОНЕЦ массива (после decisions-элемента), по образцу relationship:
```ts
      isV2BirthdayEnabled(userId)
        ? withTimeout(buildBirthdaySection(userId), CROSS_DOMAIN_BUDGET_MS, null).catch(() => null)
        : Promise.resolve(null),
```
3. В объект `data` (где `relationship, decisions,`) добавь `birthdays,`.

- [ ] **Step 5: Verify tsc**

Run: `cd packages/server && npx tsc --noEmit`
Expected: чисто (массив и деструктуризация согласованы по длине/порядку — перепроверь, что `birthdays` стоит последним и там, и там).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/v2-enrichment.ts
git commit -F - <<'EOF'
feat(birthday): enrichment section «Скоро ДР» (flag-gated, window 7d)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Поведенческий + структурный тесты + финальный verify

**Files:**
- Create: `src/services/birthday/birthday.it.test.ts`
- Create: `src/services/birthday/birthday-wiring.test.ts`

- [ ] **Step 1: Write the behavioral integration test**

Create `src/services/birthday/birthday.it.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from '../entity-graph/index.js';
import { listPersonBirthdays, buildUpcomingBirthdays } from './index.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  process.env.FEATURE_V2_BIRTHDAY = 'all';
});

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'B', passwordHash: 'x' } });
  return u.id;
}

describe('birthday: запись + чтение (тест-БД)', () => {
  it('upsertEntity пишет birthday в attributes и НЕ затирает прочие ключи', async () => {
    const userId = await seedUser(`bd-a-${Date.now()}@a.test`);
    const graph = getEntityGraph();
    // существующий человек с другим атрибутом
    const first = await graph.upsertEntity(userId, {
      type: 'person',
      name: 'Ахмет',
      attributes: { role: 'клиент' } as Record<string, unknown>,
      importance: 5,
    });
    // дописываем ДР тем же путём, что set_birthday
    await graph.upsertEntity(userId, {
      type: 'person',
      name: 'Ахмет',
      attributes: { birthday: { day: 12, month: 5, year: 1994 } } as Record<string, unknown>,
      importance: 5,
    });
    const ent = await prisma.entity.findUnique({ where: { id: first.id } });
    const attrs = (ent?.attributes ?? {}) as Record<string, unknown>;
    expect(attrs.role).toBe('клиент'); // мерж не затёр
    expect(attrs.birthday).toEqual({ day: 12, month: 5, year: 1994 });

    const rows = await listPersonBirthdays(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ахмет');
  });

  it('buildUpcomingBirthdays ловит ДР в окне и игнорит дальний', async () => {
    const userId = await seedUser(`bd-b-${Date.now()}@a.test`);
    const graph = getEntityGraph();
    const now = new Date('2026-06-05T00:00:00Z');
    await graph.upsertEntity(userId, {
      type: 'person', name: 'Завтрашний',
      attributes: { birthday: { day: 6, month: 6 } } as Record<string, unknown>, importance: 7,
    });
    await graph.upsertEntity(userId, {
      type: 'person', name: 'Дальний',
      attributes: { birthday: { day: 6, month: 9 } } as Record<string, unknown>, importance: 7,
    });
    const win1 = await buildUpcomingBirthdays(userId, now, 1);
    expect(win1.map((r) => r.name)).toEqual(['Завтрашний']);
    const win7 = await buildUpcomingBirthdays(userId, now, 7);
    expect(win7.map((r) => r.name)).toEqual(['Завтрашний']); // Дальний (>90д) вне 7
  });

  it('cross-user изоляция: B не видит ДР из A', async () => {
    const a = await seedUser(`bd-c1-${Date.now()}@a.test`);
    const b = await seedUser(`bd-c2-${Date.now()}@a.test`);
    await getEntityGraph().upsertEntity(a, {
      type: 'person', name: 'СекретA',
      attributes: { birthday: { day: 1, month: 1 } } as Record<string, unknown>, importance: 5,
    });
    expect(await listPersonBirthdays(b)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run behavioral test (needs test DB)**

Run: `cd packages/server && npm run test:db:up && npx vitest run src/services/birthday/birthday.it.test.ts --project integration`
Expected: PASS (3 теста). Если `entity-graph` требует pgvector — тест-БД уже сконфигурирована (как в `relationship-link.it.test.ts`).

- [ ] **Step 3: Write the structural + money-safety test**

Create `src/services/birthday/birthday-wiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ENGINE = readFileSync(join(__dirname, '..', 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, '..', 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '..', '..', 'lib', 'feature-flags.ts'), 'utf8');
const TOOLS_INDEX = readFileSync(join(__dirname, '..', '..', 'tools', 'index.ts'), 'utf8');
const TOOL = readFileSync(join(__dirname, '..', '..', 'tools', 'set-birthday.ts'), 'utf8');
const GATHER = readFileSync(join(__dirname, 'birthday.ts'), 'utf8');

describe('birthday wiring (structural)', () => {
  it('флаг isV2BirthdayEnabled существует', () => {
    expect(FLAGS).toMatch(/export function isV2BirthdayEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_BIRTHDAY/);
  });
  it('NudgeSource + TEMPLATES + scoreSignificance + detectCandidates содержат birthday_upcoming', () => {
    expect(ENGINE).toMatch(/'birthday_upcoming'/);
    expect(ENGINE).toMatch(/birthday_upcoming:\s*{/); // TEMPLATES key
    expect(ENGINE).toMatch(/case 'birthday_upcoming':/); // scoreSignificance
    expect(ENGINE).toMatch(/detectBirthday\(userId\)/); // registered
  });
  it('detectBirthday имеет ранний флаг-гейт (off=identical)', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('async function detectBirthday'));
    expect(fn).toMatch(/if\s*\(!isV2BirthdayEnabled\(userId\)\)\s*return\s*\[\]/);
  });
  it('enrichment-врезка за флагом + поле birthdays', () => {
    expect(ENRICH).toMatch(/birthdays:\s*string\s*\|\s*null/);
    expect(ENRICH).toMatch(/isV2BirthdayEnabled\(userId\)/);
    expect(ENRICH).toMatch(/buildBirthdaySection\(userId\)/);
    expect(ENRICH).toMatch(/if\s*\(data\.birthdays\)/);
  });
  it('set_birthday зарегистрирован в ALL_TOOLS', () => {
    expect(TOOLS_INDEX).toMatch(/setBirthdayTool/);
    expect(TOOL).toMatch(/name:\s*'set_birthday'/);
    expect(TOOL).toMatch(/needsConfirm:\s*false/);
  });
  it('money-safety: services/birthday/birthday.ts не делает write в prisma', () => {
    expect(GATHER).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany|createMany)/);
  });
});
```

- [ ] **Step 4: Run structural test**

Run: `cd packages/server && npx vitest run src/services/birthday/birthday-wiring.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Full suite + tsc**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: tsc чисто; вся unit-сюита зелёная (baseline ~2383 + новые). Integration-проект отдельно (`npm run test:it`).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/birthday/birthday.it.test.ts packages/server/src/services/birthday/birthday-wiring.test.ts
git commit -F - <<'EOF'
test(birthday): behavioral (.it) + structural wiring + money-safety guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Independent review**

Запусти независимое ревью на весь дифф фичи (агент `pr-review-toolkit:code-reviewer` или `superpowers:code-reviewer`), фокус: off=байт-идентично (флаг-гейты), money-safety (ноль денежных write), TS strict, отсутствие дублирования с `detectStaleEntity`. Исправь замечания, перепроверь сюиту.

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:**
- Хранение `Entity.attributes.birthday` → Task 4 (upsertEntity merge) + Task 3 (чтение). ✓
- Хелперы parse/daysUntil/age/upcoming/format → Task 2. ✓ (`formatBirthdayNudge` из спеки заменён на пару `whenLabel`+`ageSuffix` + TEMPLATES — текст нуджа рендерит движок, как у всех источников; enrichment-текст рендерит `formatBirthdaySection`. Это устраняет дублирование рендера.)
- Инструмент `set_birthday` needsConfirm:false + регистрация → Task 4. ✓
- Детектор union+TEMPLATES+score+detectBirthday+register+exhaustiveness → Task 5. ✓
- Enrichment врезка за флагом, окно 7 → Task 6. ✓
- Флаг → Task 1. ✓
- Тесты pure/behavioral/structural/money-safety → Tasks 2,7. ✓
- Money-safety (ноль prisma write в services/birthday) → Task 7 структурный гард. ✓ (запись только в `tools/set-birthday` через entity-graph upsert.)

**2. Placeholder scan:** Нет TBD/TODO. Все шаги с кодом содержат код. Единственные «досверь grep'ом» — точные имена `upsertEntity`/`ALL_TOOLS`/строки в существующих файлах: это интеграционные точки в чужом коде, не плейсхолдеры логики.

**3. Type consistency:** `Birthday`, `PersonBirthdayRow`, `UpcomingBirthday` определены в Task 2 и используются в Tasks 3-7 одинаково. `daysUntilBirthday(b, now)`, `ageOnNextBirthday(b, now)` (берут `Birthday`, не голый year — корректнее, чем черновая сигнатура спеки). Payload-ключи детектора (`whenLabel`, `ageSuffix`, `name`) совпадают с плейсхолдерами TEMPLATES (`{{whenLabel}}`, `{{ageSuffix}}`, `{{name}}`). Поле `birthdays` добавлено и в тип, и в деструктуризацию, и в data, и в push — порядок «последним» зафиксирован в Task 6.
