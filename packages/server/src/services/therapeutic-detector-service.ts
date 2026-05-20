import { prisma } from '../lib/prisma.js';
import { persistCandidates } from './insight-store.js';
import { localDayStartUTC, localDateStr } from '../lib/tz.js';
import {
  burnoutDetector,
  sleepDisruptionDetector,
  conflictFollowupDetector,
  missedImportantDateDetector,
  intentionDeviationDetector,
} from './therapeutic-detectors.js';
import type { InsightCandidate } from './insight-core.js';

/**
 * Phase 6 C4.2 — оркестратор therapeutic-детекторов (glue).
 *  - Каденс 1×/день/юзер (tz-корректно).
 *  - ≤1 therapeutic-инсайт СОЗДАЁТСЯ за день (top-severity);
 *    остальные сработавшие отбрасываются — UI не пухнет (спека:
 *    «не более одной проактивной therapeutic-инициативы в день»).
 *  - Дальше R10 cooldown + R6 доставка + R11 quiet-hours
 *    применяются автоматически (insight-store + scheduler).
 *  - Sensitive (C1-d): ChatMessage читаем ТОЛЬКО crisis=false.
 *  - Intention-детектор: требует Memory.type='intention' — если
 *    таких записей нет, молчит честно (не выдумывает намерение).
 */

const DAY_MS = 86_400_000;
// Узкий precision-set для конфликт-упоминаний (Cyrillic-safe, без \b).
const CONFLICT_RE =
  /(поссорил(ся|ась)|разругал(ся|ась)|повздорил|накричал(а)?|обидел(и|а|ся|ась)|обидно)/i;

function pickTop(cands: InsightCandidate[]): InsightCandidate | null {
  if (cands.length === 0) return null;
  return cands.reduce((top, x) => (x.severity > top.severity ? x : top));
}

async function gather(userId: string, now: Date, tz: string) {
  const dayStart = localDayStartUTC(tz, now);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since14d = new Date(now.getTime() - 14 * DAY_MS);
  const since48h = new Date(now.getTime() - 2 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [events7d, journal14d, mentions, lastConflictFu, memDates, memIntents, foodWk, foodPrev] =
    await Promise.all([
      prisma.calendarEvent.findMany({
        where: { userId, date: { gte: since7d } },
        select: { date: true },
      }),
      prisma.journalEntry.findMany({
        where: { userId, date: { gte: since14d } },
        orderBy: { date: 'asc' },
        select: { date: true, sleepHours: true },
      }),
      // C1(d): conflict-упоминания читаем БЕЗ кризис-ходов.
      prisma.chatMessage.findMany({
        where: {
          userId,
          crisis: false,
          role: 'user',
          createdAt: { gte: since48h },
        },
        orderBy: { createdAt: 'asc' },
        select: { content: true, createdAt: true },
      }),
      prisma.insight.findFirst({
        where: { userId, kind: 'therapeutic_conflict_followup' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.memory.findMany({
        where: { userId, type: 'important_date' },
        select: { content: true, details: true, createdAt: true },
      }),
      prisma.memory.findMany({
        where: { userId, type: 'intention' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { content: true },
      }),
      prisma.expense.aggregate({
        where: { userId, category: 'food', date: { gte: since7d } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: {
          userId,
          category: 'food',
          date: { gte: new Date(since7d.getTime() - 7 * DAY_MS), lt: since7d },
        },
        _sum: { amount: true },
      }),
    ]);

  // meetingsPerDay (последние 7 локальных дней).
  const meetingsPerDay = Array.from({ length: 7 }, (_, k) => {
    const start = new Date(dayStart.getTime() - (6 - k) * DAY_MS);
    const end = new Date(start.getTime() + DAY_MS);
    return events7d.filter((e) => e.date >= start && e.date < end).length;
  });

  // sleep hours, индексы по локальному дню.
  const hoursLast14d: Array<number | null> = Array.from(
    { length: 14 },
    (_, k) => {
      const start = new Date(dayStart.getTime() - (13 - k) * DAY_MS);
      const e = journal14d.find(
        (j) => j.date.getTime() === start.getTime() && j.sleepHours != null,
      );
      return e?.sleepHours ?? null;
    },
  );

  // conflict-упоминания (узкий regex).
  const conflictMentions = mentions
    .filter((m) => CONFLICT_RE.test(m.content))
    .map((m) => ({ snippet: m.content.slice(0, 80), at: m.createdAt }));

  // important_date: парсим из Memory.content (формат свободный — берём
  // как есть; date из createdAt — корректнее было бы поле, но пока
  // используем тип memory как маркер; точный date в details/JSON —
  // упрощение v1, флаг).
  const dates = memDates
    .map((m) => ({ what: m.content, date: m.createdAt }));

  // intention: первая активная (для v1 — берём первую релевантную
  // под food, если есть).
  const intentFood = memIntents.find((m) =>
    /(трат|еда|еду|еде|расход)/i.test(m.content),
  );

  const todayLocal = localDateStr(tz, now);

  return {
    meetingsPerDay,
    hoursLast14d,
    conflictMentions,
    lastConflictFu: lastConflictFu?.createdAt ?? null,
    dates,
    todayLocal,
    intentFood: intentFood
      ? {
          stated: intentFood.content,
          lastWeek: foodPrev._sum.amount ?? 0,
          thisWeek: foodWk._sum.amount ?? 0,
        }
      : null,
  };
}

/**
 * Один прогон детекторов: ≤1 candidate создаётся (top-severity).
 * Возвращает что произошло.
 */
export async function runTherapeuticDetectors(
  userId: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; created: number; chosenKind?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone ?? 'UTC';
  const g = await gather(userId, now, tz);

  const cands: InsightCandidate[] = [];
  const b = burnoutDetector({ meetingsPerDay: g.meetingsPerDay });
  if (b) cands.push(b);
  const s = sleepDisruptionDetector({ hoursLast14d: g.hoursLast14d });
  if (s) cands.push(s);
  const c = conflictFollowupDetector({
    mentions: g.conflictMentions,
    lastFollowupAt: g.lastConflictFu,
    now,
  });
  if (c) cands.push(c);
  const d = missedImportantDateDetector({
    dates: g.dates,
    todayLocal: g.todayLocal,
  });
  if (d) cands.push(d);
  if (g.intentFood) {
    const i = intentionDeviationDetector({
      stated: g.intentFood.stated,
      lastWeekValue: g.intentFood.lastWeek,
      thisWeekValue: g.intentFood.thisWeek,
      direction: 'less',
    });
    if (i) cands.push(i);
  }

  const top = pickTop(cands);
  if (!top) return { ran: true, created: 0 };

  const res = await persistCandidates(userId, [top], now);
  return { ran: true, created: res.created, chosenKind: top.kind };
}

/**
 * Каденс 1×/день/юзер: если уже есть therapeutic-инсайт за локальные
 * сутки — пропуск (спека: ≤1 therapeutic/день/юзер). Идемпотентно.
 */
export async function runTherapeuticDetectorsDaily(
  userId: string,
  now: Date = new Date(),
): Promise<{ ran: boolean; created: number; chosenKind?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const dayStart = localDayStartUTC(user?.timezone ?? 'UTC', now);
  const already = await prisma.insight.count({
    where: {
      userId,
      kind: { startsWith: 'therapeutic_' },
      createdAt: { gte: dayStart },
    },
  });
  if (already > 0) return { ran: false, created: 0 };
  return runTherapeuticDetectors(userId, now);
}
