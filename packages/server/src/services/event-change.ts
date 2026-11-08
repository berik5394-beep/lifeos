/**
 * Перенос и удаление встречи — общий путь для мозга (move_event / cancel_event)
 * и экрана (PUT / DELETE /events). Раньше «перенеси» создавало ВТОРУЮ встречу
 * (create_event искал старую только с тем же временем), а синхронизация с
 * Google затирала локальный перенос старыми данными (изменения не отправлялись).
 */
import { prisma } from '../lib/prisma.js';
import { addCivilDays, dateOnlyUTC, localDateStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { normalizeHabit, stemTokens } from '../tools/_habit-match.js';
import { hmToMinutes, minToHM } from './schedule-conflict/index.js';
import { deleteRemoteEvent, getFreshGoogleAccessToken, patchEvent } from './google-calendar.js';

type EventRow = {
  id: string;
  title: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  externalId: string | null;
};

const civil = (d: Date) => d.toISOString().slice(0, 10);
export const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Слова, которые не отличают одну встречу от другой («встреча с …», «созвон в …»). */
const GENERIC = new Set([
  'встреч', 'созвон', 'звонок', 'звонк', 'событи', 'мероприяти', 'митинг', 'встречк',
  'с', 'со', 'у', 'на', 'в', 'во', 'к', 'по', 'за', 'и', 'мо', 'мою', 'мой', 'мое', 'эт', 'тот', 'т',
]);
const yo = (t: string) => t.replace(/ё/g, 'е');
const root = (t: string) => yo(t.length >= 4 ? t.slice(0, 4) : t);
const distinct = (s: string) => stemTokens(s).filter((t) => !GENERIC.has(yo(t)) && !/^\d+$/.test(t));

/**
 * Строгий матч названия встречи (аудит-ревью 2026-11-08: нечёткий матч привычек
 * отдавал «Встречу с Сериком» на «встреча с Ахметом» — и её бы удалили). ВСЕ
 * различающие слова запроса (имена, не «встреча/созвон/с») должны быть в
 * названии по корню. Нет различающих («встреча») — только точное совпадение.
 * Возвращает подходящие РАЗНЫЕ названия.
 */
export function matchEventTitles(query: string, titles: string[]): string[] {
  const unique = [...new Map(titles.map((t) => [normalizeHabit(t), t])).values()];
  const qd = distinct(query);
  if (qd.length === 0) {
    const nq = normalizeHabit(query);
    return unique.filter((t) => normalizeHabit(t) === nq);
  }
  return unique.filter((t) => {
    const tt = stemTokens(t);
    return qd.every((q) => tt.some((w) => root(w) === root(q) || (q.length < 4 && yo(w).startsWith(yo(q)))));
  });
}

export type EventLookup =
  | { kind: 'one'; event: EventRow; sameTitle: number }
  | { kind: 'many'; titles: string[] }
  | { kind: 'none' }
  | { kind: 'none_on_date' };

/**
 * Найти встречу. Одинаковые названия (еженедельная «Планёрка») → на указанную
 * дату, иначе ближайшую будущую. Названа дата, а в неё такой нет — НЕ берём
 * другую (раньше «убери планёрку в пятницу» удаляло понедельничную).
 * Окно: вчера … +120 дней.
 */
export async function findEventByTitle(
  userId: string,
  title: string,
  opts: { date?: string } = {},
  now: Date = new Date(),
): Promise<EventLookup> {
  const today = localDateStr(await getUserTimezone(userId), now);
  const events = await prisma.calendarEvent.findMany({
    where: { userId, date: { gte: dateOnlyUTC(addCivilDays(today, -1)), lte: dateOnlyUTC(addCivilDays(today, 120)) } },
    select: { id: true, title: true, date: true, startTime: true, endTime: true, location: true, description: true, externalId: true },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 300,
  });
  const hits = matchEventTitles(title, events.map((e) => e.title));
  if (hits.length === 0) return { kind: 'none' };
  if (hits.length > 1) return { kind: 'many', titles: hits.slice(0, 4) };
  const key = normalizeHabit(hits[0]);
  const same = events.filter((e) => normalizeHabit(e.title) === key);
  if (opts.date) {
    const onDate = same.find((e) => civil(e.date) === opts.date);
    return onDate ? { kind: 'one', event: onDate, sameTitle: same.length } : { kind: 'none_on_date' };
  }
  const pick = same.find((e) => civil(e.date) >= today) ?? same[same.length - 1];
  return { kind: 'one', event: pick, sameTitle: same.length };
}

/** Честный ответ, когда встреча не определилась однозначно. */
export function lookupMiss(r: Exclude<EventLookup, { kind: 'one' }>, title: string, date?: string): string {
  if (r.kind === 'many') return `Какую именно: ${r.titles.map((t) => `«${t}»`).join(', ')}?`;
  if (r.kind === 'none_on_date' && date) return `На ${fmtDay(date)} встречи «${title}» нет.`;
  return `Не нашёл встречу «${title}» в календаре.`;
}

/**
 * Новое время с сохранением длительности: дали только начало — конец сдвигаем
 * на ту же длину. Ничего не дали — прежнее время.
 */
export function shiftTimes(
  old: { startTime: string | null; endTime: string | null },
  next: { startTime?: string | null; endTime?: string | null },
): { startTime: string | null; endTime: string | null } {
  if (next.startTime === undefined && next.endTime === undefined) return { startTime: old.startTime, endTime: old.endTime };
  const startTime = next.startTime === undefined ? old.startTime : next.startTime;
  if (next.endTime !== undefined) return { startTime, endTime: next.endTime };
  const os = old.startTime ? hmToMinutes(old.startTime) : null;
  const oe = old.endTime ? hmToMinutes(old.endTime) : null;
  const ns = startTime ? hmToMinutes(startTime) : null;
  if (os == null || oe == null || ns == null || oe <= os) return { startTime, endTime: null };
  const end = ns + (oe - os);
  return { startTime, endTime: end < 24 * 60 ? minToHM(end) : '23:59' };
}

export type GoogleSync = 'none' | 'ok' | 'failed';

/** Отправить правку/удаление в Google (если встреча оттуда или уже выгружена). */
export async function pushToGoogle(userId: string, ev: EventRow, op: 'patch' | 'delete'): Promise<GoogleSync> {
  if (!ev.externalId) return 'none';
  try {
    const token = await getFreshGoogleAccessToken(userId);
    if (op === 'delete') await deleteRemoteEvent(token, ev.externalId);
    else {
      await patchEvent(token, ev.externalId, {
        title: ev.title,
        date: civil(ev.date),
        startTime: ev.startTime,
        endTime: ev.endTime,
        location: ev.location,
        description: ev.description,
      });
    }
    return 'ok';
  } catch (err) {
    console.warn(`[event-change] google ${op} failed user=${userId}:`, err instanceof Error ? err.message : err);
    return 'failed';
  }
}

/** Честная приписка, если в Google не ушло (синхронизация вернула бы старое). */
export function googleNote(g: GoogleSync, op: 'patch' | 'delete'): string {
  if (g !== 'failed') return '';
  return op === 'delete'
    ? ' В Google Календаре не удалилась — убери там, иначе синхронизация вернёт её.'
    : ' В Google Календаре не обновилась — поправь там или переподключи Google, иначе синхронизация вернёт старое время.';
}

export async function moveEvent(
  userId: string,
  eventId: string,
  next: { date?: string; startTime?: string | null; endTime?: string | null; title?: string },
): Promise<{ before: EventRow; after: EventRow; google: GoogleSync } | null> {
  const before = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId },
    select: { id: true, title: true, date: true, startTime: true, endTime: true, location: true, description: true, externalId: true },
  });
  if (!before) return null;
  const times = shiftTimes(before, next);
  const after = await prisma.calendarEvent.update({
    where: { id: before.id },
    data: {
      ...(next.title ? { title: next.title } : {}),
      ...(next.date ? { date: dateOnlyUTC(next.date) } : {}),
      startTime: times.startTime,
      endTime: times.endTime,
    },
    select: { id: true, title: true, date: true, startTime: true, endTime: true, location: true, description: true, externalId: true },
  });
  const google = await pushToGoogle(userId, after, 'patch');
  return { before, after, google };
}

export async function removeEvent(userId: string, eventId: string): Promise<{ removed: EventRow; google: GoogleSync } | null> {
  const ev = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId },
    select: { id: true, title: true, date: true, startTime: true, endTime: true, location: true, description: true, externalId: true },
  });
  if (!ev) return null;
  const google = await pushToGoogle(userId, ev, 'delete');
  await prisma.calendarEvent.deleteMany({ where: { id: ev.id, userId } });
  return { removed: ev, google };
}

/** «12.11 в 14:00–15:00» для сообщений. */
export function whenText(ev: { date: Date; startTime: string | null; endTime: string | null }): string {
  const d = fmtDay(civil(ev.date));
  if (!ev.startTime) return d;
  return `${d} в ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}`;
}
