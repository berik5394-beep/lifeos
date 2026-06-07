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
  /** CRM-тип человека (План B усиление): пробрасывается в нудж для буста значимости. */
  personType?: string;
}

export interface UpcomingBirthday {
  entityId: string;
  name: string;
  importance: number;
  daysUntil: number;
  age: number | null;
  personType?: string;
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
      personType: p.personType,
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

// Память дней памяти: capture-extractor пишет имя ключа свободно — читаем терпимо.
const DEATH_DATE_KEYS = ['death_date', 'deathDate', 'died', 'date_of_death', 'memorial_date'];

export function pickDeathDate(attrs: Record<string, unknown>): unknown {
  for (const k of DEATH_DATE_KEYS) {
    const v = attrs[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function formatMemorialSection(rows: UpcomingBirthday[]): string | null {
  if (!rows || rows.length === 0) return null;
  const parts = rows.map((r) => `${r.name} — ${whenLabel(r.daysUntil)}`);
  return `День памяти: ${parts.join('; ')}`;
}
