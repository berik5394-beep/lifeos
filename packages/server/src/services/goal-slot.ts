/**
 * Срез «goal-slot» — хелперы для предложения свободного окна под отстающую цель.
 * READ-ONLY: только чтение календаря, никаких записей.
 */
import { prisma } from '../lib/prisma.js';
import { findFreeSlots, type FreeSlot } from '../tools/_slots.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

const RU_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];

/** Имя дня (вин. падеж «в …») из civil 'YYYY-MM-DD'. TZ-безопасно (UTC-аксессоры). */
export function ruDayName(civilDate: string): string {
  return RU_DAYS[new Date(civilDate + 'T00:00:00Z').getUTCDay()];
}

/**
 * Ближайшее свободное окно ≥minDuration в [завтра..+horizonДн] по календарю юзера.
 * READ-ONLY. Завтра (не сегодня): findFreeSlots не учитывает «уже прошло сегодня».
 * Civil-даты юзера (convA, как get-free-slots). null = окна нет / ошибка (best-effort).
 */
export async function findUpcomingSlot(
  userId: string,
  now: Date = new Date(),
  minDurationMinutes = 45,
  horizonDays = 7,
): Promise<FreeSlot | null> {
  try {
    const tz = await getUserTimezone(userId);
    const todayCivil = localDateStr(tz, now);
    const dayMs = 86_400_000;
    const fromDate = new Date(new Date(todayCivil + 'T00:00:00Z').getTime() + dayMs);
    const toDate = new Date(fromDate.getTime() + (horizonDays - 1) * dayMs);
    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, startTime: true, endTime: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 200,
    });
    const slots = findFreeSlots(events, fromDate, toDate, minDurationMinutes);
    return slots[0] ?? null;
  } catch {
    return null;
  }
}

/** Чистый хвост-предложение к goal_behind-сообщению. */
export function formatGoalSlotTail(slot: FreeSlot): string {
  const mins = Math.min(slot.durationMinutes, 120);
  return ` В ${ruDayName(slot.date)} (${slot.date.slice(8, 10)}.${slot.date.slice(5, 7)}) в ${slot.from} свободно ~${mins} мин — поставить занятие по цели? Скажи «да» — закину в план.`;
}
