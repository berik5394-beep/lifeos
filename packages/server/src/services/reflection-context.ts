/**
 * Рефлексия юзера для мозга: дневник (сон, энергия, настроение, записи) и
 * заметки недели (заметки / что улучшить / благодарность / что получилось).
 *
 * Раньше мозг брал из дневника только сон (energy-link), а заметки недели
 * не видел вовсе — «друг» не знал, что человек сам писал про свои дни.
 * READ-ONLY, числа только из БД (идут в чат и бриф под гардом честности).
 * Шкалы: настроение и энергия 1–10 (как на сервере и в приложении).
 */
import { prisma } from '../lib/prisma.js';
import { localDateStr, addCivilDays, dateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';

export type JournalRow = {
  date: string; // 'YYYY-MM-DD'
  sleepHours: number | null;
  energy: number | null;
  mood: number | null;
  notes: string | null;
};

export type WeekNoteRow = { notes: string; improve: string; gratitude: string; wins: string };

/** Настроение/энергия ≤ этого — «тяжело» (на шкале 1–10 это смайлики «ужасно/плохо»). */
export const LOW_LEVEL = 4;
/** Столько дней подряд «тяжело» — повод мягко спросить, как ты. */
export const LOW_STREAK_DAYS = 3;

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
function short(s: string, max = 120): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Понедельник недели календарной даты 'YYYY-MM-DD'. */
export function mondayOf(civil: string): string {
  const d = new Date(civil + 'T00:00:00Z');
  const wd = d.getUTCDay();
  return addCivilDays(civil, wd === 0 ? -6 : 1 - wd);
}

/**
 * Сколько последних записанных дней подряд (до сегодня включительно, без
 * пропусков дат) настроение ИЛИ энергия были низкими.
 */
export function lowStreak(rows: JournalRow[], today: string): number {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  let n = 0;
  // сегодня ещё могли не заполнить — начинаем с сегодня, если есть, иначе со вчера
  let day = byDate.has(today) ? today : addCivilDays(today, -1);
  for (;;) {
    const r = byDate.get(day);
    if (!r) break;
    const low = (r.mood != null && r.mood <= LOW_LEVEL) || (r.energy != null && r.energy <= LOW_LEVEL);
    if (!low) break;
    n += 1;
    day = addCivilDays(day, -1);
  }
  return n;
}

/** Блок дневника за ~неделю. Нет записей — null. */
export function formatJournalSection(rows: JournalRow[], today: string): string | null {
  const filled = rows.filter((r) => r.sleepHours != null || r.energy != null || r.mood != null || (r.notes ?? '').trim());
  if (filled.length === 0) return null;
  const sorted = [...filled].sort((a, b) => a.date.localeCompare(b.date));
  const parts: string[] = [];
  const sleep = avg(sorted.flatMap((r) => (r.sleepHours != null ? [r.sleepHours] : [])));
  const energy = avg(sorted.flatMap((r) => (r.energy != null ? [r.energy] : [])));
  const mood = avg(sorted.flatMap((r) => (r.mood != null ? [r.mood] : [])));
  if (sleep != null) parts.push(`сон в среднем ${r1(sleep)} ч`);
  if (energy != null) parts.push(`энергия ${r1(energy)}/10`);
  if (mood != null) parts.push(`настроение ${r1(mood)}/10`);

  // Тренд настроения: последние 3 записи против предыдущих.
  const moods = sorted.flatMap((r) => (r.mood != null ? [r.mood] : []));
  if (moods.length >= 5) {
    const recent = avg(moods.slice(-3)) as number;
    const before = avg(moods.slice(0, -3)) as number;
    if (recent - before <= -1.5) parts.push('настроение падает последние дни');
    else if (recent - before >= 1.5) parts.push('настроение растёт последние дни');
  }
  const streak = lowStreak(sorted, today);
  if (streak >= LOW_STREAK_DAYS) parts.push(`${streak} дн. подряд тяжело (низкое настроение/энергия)`);

  const last = sorted[sorted.length - 1];
  const lastNotes = (last.notes ?? '').trim();
  const head = `Дневник (${filled.length} дн. из 7): ${parts.join(', ') || 'есть записи'}`;
  return lastNotes ? `${head}. Последняя запись (${last.date === today ? 'сегодня' : last.date}): «${short(lastNotes)}»` : head;
}

/** Заметки недели. Пусто на этой неделе → напоминание про «улучшить» с прошлой. */
export function formatWeekNotesSection(current: WeekNoteRow | null, previous: WeekNoteRow | null): string | null {
  const parts: string[] = [];
  if (current) {
    if (current.wins.trim()) parts.push(`получилось — «${short(current.wins)}»`);
    if (current.improve.trim()) parts.push(`хочет улучшить — «${short(current.improve)}»`);
    if (current.gratitude.trim()) parts.push(`благодарность — «${short(current.gratitude)}»`);
    if (current.notes.trim()) parts.push(`заметки — «${short(current.notes)}»`);
  }
  if (parts.length > 0) return `Заметки недели (сам записал): ${parts.join('; ')}`;
  if (previous?.improve.trim()) return `На прошлой неделе собирался улучшить: «${short(previous.improve)}»`;
  return null;
}

export type StepRow = { date: string; steps: number };

const fmtInt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Шаги из «Здоровья» за ~неделю. Раньше StepLog читал только «Разбор» —
 * мозг (чат, бриф) про шаги не знал. Считаем только дни, за которые телефон
 * прислал шаги; сегодняшние — «пока» (день не закончен). Нет данных — null.
 */
export function formatStepsSection(rows: StepRow[], today: string): string | null {
  const days = rows.filter((r) => r.steps > 0);
  if (days.length === 0) return null;
  const parts: string[] = [];
  const t = days.find((r) => r.date === today);
  if (t) parts.push(`сегодня пока ${fmtInt(t.steps)}`);
  const y = days.find((r) => r.date === addCivilDays(today, -1));
  if (y) parts.push(`вчера ${fmtInt(y.steps)}`);
  const past = days.filter((r) => r.date !== today);
  if (past.length >= 2) {
    const mean = past.reduce((a, r) => a + r.steps, 0) / past.length;
    parts.push(`в среднем ${fmtInt(mean)} в день (${past.length} дн. с данными)`);
  }
  if (parts.length === 0) return null;
  return `Шаги (из «Здоровья»): ${parts.join(', ')}`;
}

export interface ReflectionContext {
  journal: string | null;
  weekNotes: string | null;
  /** Шаги из «Здоровья» за неделю (чат/мозг). */
  steps: string | null;
  /** Для брифа: коротко про вчера/сегодня. */
  briefLine: string | null;
  lowStreakDays: number;
}

export async function gatherReflection(userId: string, now: Date = new Date()): Promise<ReflectionContext> {
  const tz = await getUserTimezone(userId);
  const today = localDateStr(tz, now);
  const from = addCivilDays(today, -6);
  const monday = mondayOf(today);
  const [journalRaw, notes, stepRaw] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { userId, date: { gte: dateOnlyUTC(from), lte: dateOnlyUTC(today) } },
      select: { date: true, sleepHours: true, energy: true, mood: true, notes: true },
    }),
    prisma.weekNote.findMany({
      where: { userId, weekStart: { in: [dateOnlyUTC(monday), dateOnlyUTC(addCivilDays(monday, -7))] } },
      select: { weekStart: true, notes: true, improve: true, gratitude: true, wins: true },
    }),
    prisma.stepLog.findMany({
      where: { userId, date: { gte: dateOnlyUTC(from), lte: dateOnlyUTC(today) } },
      select: { date: true, steps: true },
    }),
  ]);
  const stepRows: StepRow[] = stepRaw.map((r) => ({ date: r.date.toISOString().slice(0, 10), steps: r.steps }));
  const rows: JournalRow[] = journalRaw.map((j) => ({ ...j, date: j.date.toISOString().slice(0, 10) }));
  const cur = notes.find((n) => n.weekStart.toISOString().slice(0, 10) === monday) ?? null;
  const prev = notes.find((n) => n.weekStart.toISOString().slice(0, 10) !== monday) ?? null;

  const yesterday = addCivilDays(today, -1);
  const y = rows.find((r) => r.date === yesterday) ?? rows.find((r) => r.date === today);
  const yParts: string[] = [];
  if (y?.sleepHours != null) yParts.push(`сон ${y.sleepHours} ч`);
  if (y?.mood != null) yParts.push(`настроение ${y.mood}/10`);
  if (y?.energy != null) yParts.push(`энергия ${y.energy}/10`);
  const ySteps = stepRows.find((r) => r.date === yesterday && r.steps > 0);
  const focus = cur?.improve.trim() ? `фокус недели (сам записал): «${short(cur.improve, 60)}»` : null;
  const briefParts = [
    yParts.length ? `вчера по дневнику: ${yParts.join(', ')}` : null,
    ySteps ? `вчера ${fmtInt(ySteps.steps)} шагов (из «Здоровья»)` : null,
    focus,
  ].filter(Boolean);

  return {
    journal: formatJournalSection(rows, today),
    weekNotes: formatWeekNotesSection(cur, prev),
    steps: formatStepsSection(stepRows, today),
    briefLine: briefParts.length ? briefParts.join('; ') : null,
    lowStreakDays: lowStreak(rows, today),
  };
}
