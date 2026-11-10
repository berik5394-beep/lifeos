/**
 * «Незакрытое» — о чём друг спросил бы «как прошло?» (Berik 2026-11-10, аудит:
 * раньше источник был только память типа event/emotion, а в живом чате туда
 * почти ничего не попадало — будущее событие становилось встречей/задачей,
 * переживания не запоминались вовсе).
 *
 * Источники (по приоритету):
 *  1. календарь — значимое событие (собеседование, экзамен, врач, операция…), которое
 *     уже прошло: вчера–3 дня назад, или сегодня, но уже закончилось;
 *  2. задачи — значимое дело с датой вчера–3 дня назад;
 *  3. переживание из разговора (Memory type=emotion из чата) 12 ч – 5 дн;
 *  4. прошедшее событие, рассказанное в чате (Memory type=event) 12 ч – 10 дн.
 * «Когда спросить» — из даты события; «закрыто» — журнал FollowUpLog:
 * предложено → держим сутки (модель видит строку, спрашивает один раз) → закрыто.
 * Спрошенное пушем «как ты?» (check_in:<memoryId>) в чате не повторяем.
 */
import { prisma } from '../lib/prisma.js';
import { localDateOnlyUTC, localHour } from '../lib/tz.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Сколько держим одно «незакрытое», прежде чем закрыть и взять следующее. */
export const FOLLOW_UP_HOLD_MS = DAY_MS;
const LOOKBACK_DAYS = 3;

/** Значимое событие жизни — о нём друг спросит. Рутина («планёрка», «созвон») — нет. */
const SIGNIFICANT =
  /собеседован|интервью|экзамен|сесси[яюи]|зач[её]т|защит[аыу]|диплом|операци|врач|доктор|больниц|клиник|анализ|узи|мрт|стоматолог|зубн|роды|рожа|беремен|свадьб|помолвк|похорон|поминк|переезд|презентац|выступлени|концерт|соревновани|турнир|марафон|забег|суд(?![а-яё])|нотариус|подписани|свидани|день рождени|юбиле|вылет|перел[её]т|рейс|отпуск|поездк|путешеств|инвестор|питч|запуск|релиз|первый рабочий|увольнени|права(?![а-яё])|кредит|ипотек|покупк[аи] (?:квартир|машин|дом)/i;
/** Тяжёлое — спрашивать очень бережно, не бодрым «как прошло?». */
const HEAVY = /операци|больниц|реанимац|похорон|поминк|умер|умерл|скончал|диагноз|онколог|развод|расстал|ссор|поссор|увольнени|уволили|суд(?![а-яё])/i;

export function isSignificant(title: string): boolean {
  return SIGNIFICANT.test(title);
}
export function isHeavy(text: string): boolean {
  return HEAVY.test(text);
}

/** Сегодняшнее событие уже закончилось (конец или начало+1ч, плюс час на «выдохнуть»). */
export function eventFinishedToday(startTime: string | null, endTime: string | null, nowHour: number, nowMin: number): boolean {
  const toMin = (t: string | null) => {
    const m = t?.match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const end = toMin(endTime) ?? (toMin(startTime) !== null ? (toMin(startTime) as number) + 60 : null);
  if (end === null) return false; // весь день — спросим завтра
  return nowHour * 60 + nowMin >= end + 60;
}

export interface FollowUp {
  refKey: string;
  text: string;
  kind: 'event' | 'task' | 'concern' | 'memory';
  /** Сколько дней назад было (0 — сегодня). */
  daysAgo: number;
  heavy: boolean;
}

async function candidates(userId: string, tz: string, now: Date): Promise<FollowUp[]> {
  const today = localDateOnlyUTC(tz, now);
  const from = new Date(today.getTime() - LOOKBACK_DAYS * DAY_MS);
  const hour = localHour(tz, now);
  const min = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, minute: '2-digit' }).format(now)) || 0;
  const [events, tasks, mems] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { userId, date: { gte: from, lte: today } },
      select: { id: true, title: true, date: true, startTime: true, endTime: true },
      orderBy: { date: 'desc' },
      take: 50,
    }),
    prisma.task.findMany({
      where: { userId, cancelled: false, date: { gte: from, lt: today } },
      select: { id: true, title: true, date: true },
      orderBy: { date: 'desc' },
      take: 50,
    }),
    prisma.memory.findMany({
      where: {
        userId,
        type: { in: ['emotion', 'event'] },
        source: { not: 'v2-episodic' },
        importance: { gte: 5 },
        createdAt: { gte: new Date(now.getTime() - 10 * DAY_MS), lte: new Date(now.getTime() - 12 * HOUR_MS) },
        OR: [{ invalidAt: null }, { invalidAt: { gt: now } }],
      },
      select: { id: true, type: true, content: true, createdAt: true },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
  ]);
  const ago = (d: Date) => Math.max(0, Math.round((today.getTime() - d.getTime()) / DAY_MS));
  const out: FollowUp[] = [];
  for (const e of events) {
    if (!isSignificant(e.title)) continue;
    if (e.date.getTime() === today.getTime() && !eventFinishedToday(e.startTime, e.endTime, hour, min)) continue;
    out.push({ refKey: `event:${e.id}`, text: e.title, kind: 'event', daysAgo: ago(e.date), heavy: isHeavy(e.title) });
  }
  for (const t of tasks) {
    if (!isSignificant(t.title)) continue;
    out.push({ refKey: `task:${t.id}`, text: t.title, kind: 'task', daysAgo: ago(t.date), heavy: isHeavy(t.title) });
  }
  for (const m of mems) {
    const age = now.getTime() - m.createdAt.getTime();
    if (m.type === 'emotion' && age > 5 * DAY_MS) continue;
    out.push({
      refKey: `mem:${m.id}`,
      text: m.content,
      kind: m.type === 'emotion' ? 'concern' : 'memory',
      daysAgo: ago(localDateOnlyUTC(tz, m.createdAt)),
      heavy: m.type === 'emotion' || isHeavy(m.content),
    });
  }
  return out;
}

/**
 * Одно «незакрытое» на сейчас. Предложенное держим сутки (тот же текст), потом
 * закрываем и берём следующее. Никогда не бросает — сбой = null.
 */
export async function currentFollowUp(userId: string, tz: string, now: Date = new Date()): Promise<FollowUp | null> {
  try {
    const [cands, log, asked] = await Promise.all([
      candidates(userId, tz, now),
      prisma.followUpLog.findMany({ where: { userId }, select: { refKey: true, offeredAt: true, closedAt: true } }),
      prisma.insight.findMany({
        where: { userId, kind: 'v2_nudge', scopeKey: { startsWith: 'check_in:' }, createdAt: { gte: new Date(now.getTime() - 10 * DAY_MS) } },
        select: { scopeKey: true },
      }),
    ]);
    const byKey = new Map(log.map((l) => [l.refKey, l]));
    const askedByPush = new Set(asked.map((a) => `mem:${(a.scopeKey ?? '').slice('check_in:'.length)}`));
    // Просроченные предложенные — закрываем.
    const expired = log.filter((l) => !l.closedAt && now.getTime() - l.offeredAt.getTime() >= FOLLOW_UP_HOLD_MS).map((l) => l.refKey);
    if (expired.length > 0) {
      await prisma.followUpLog.updateMany({ where: { userId, refKey: { in: expired } }, data: { closedAt: now } });
      for (const k of expired) byKey.set(k, { refKey: k, offeredAt: new Date(0), closedAt: now });
    }
    // Уже предложенное и живое — держим.
    const open = cands.find((c) => {
      const l = byKey.get(c.refKey);
      return l && !l.closedAt;
    });
    if (open) return open;
    const next = cands.find((c) => !byKey.has(c.refKey) && !askedByPush.has(c.refKey));
    if (!next) return null;
    await prisma.followUpLog
      .upsert({
        where: { userId_refKey: { userId, refKey: next.refKey } },
        create: { userId, refKey: next.refKey, offeredAt: now },
        update: {},
      })
      .catch(() => null);
    return next;
  } catch (err) {
    console.warn('[follow-ups] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Строка для мозга (чистая). */
export function formatFollowUp(f: FollowUp): string {
  const when = f.daysAgo === 0 ? 'сегодня' : f.daysAgo === 1 ? 'вчера' : `${f.daysAgo} дн. назад`;
  const how = f.heavy
    ? 'Тема тяжёлая — спроси очень бережно, как он (или близкий) сейчас, без бодрого «как прошло?».'
    : 'Друг спросил бы, как прошло — спроси одной живой фразой.';
  const what =
    f.kind === 'concern'
      ? `его тревожило: «${f.text}» (${when})`
      : f.kind === 'memory'
        ? `он рассказывал: «${f.text}» (${when})`
        : `у него было: «${f.text}» (${when})`;
  return (
    `Незакрытое — ${what}. ${how} После ответа на его сообщение, если разговор не про срочное дело ` +
    'и ты ещё не спрашивал об этом в истории диалога. Он уже рассказал, как прошло, — не спрашивай, откликнись.'
  );
}
