/**
 * Вехи пути (G, 2026-11-10): факты «нашей истории» с датами — чтобы друг мог
 * сказать «три недели назад ты поставил первую цель», не выдумывая. Только БД.
 */
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { ruDate } from '../lib/relative-dates.js';

const DAY_MS = 86_400_000;

/** Самая длинная серия подряд идущих дней и идёт ли она сейчас (чистая). */
export function bestStreak(days: string[], today: string): { len: number; ongoing: boolean } {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let bestEnd = '';
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === DAY_MS ? run + 1 : 1;
    if (run >= best) {
      best = run;
      bestEnd = d;
    }
    prev = d;
  }
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  return { len: best, ongoing: bestEnd === today || bestEnd === yesterday };
}

export async function gatherJourney(userId: string, tz: string, now: Date = new Date()): Promise<string | null> {
  try {
    const today = localDateStr(tz, now);
    const [firstMsg, firstYearly, firstMonthly, doneTasks, logs] = await Promise.all([
      prisma.chatMessage.findFirst({ where: { userId, role: 'user' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.yearlyGoal.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { goalText: true, createdAt: true } }),
      prisma.monthlyGoal.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { goalText: true, createdAt: true } }),
      prisma.task.count({ where: { userId, completed: true, cancelled: false } }),
      prisma.habitLog.findMany({
        where: { userId, completed: true, date: { gte: new Date(now.getTime() - 180 * DAY_MS) } },
        select: { habitId: true, date: true },
        take: 5000,
      }),
    ]);
    const parts: string[] = [];
    if (firstMsg) parts.push(`первый разговор — ${ruDate(localDateStr(tz, firstMsg.createdAt))}`);
    const goal = [firstYearly, firstMonthly].filter(Boolean).sort((a, b) => a!.createdAt.getTime() - b!.createdAt.getTime())[0];
    if (goal) parts.push(`первая цель «${goal.goalText.slice(0, 60)}» — ${ruDate(localDateStr(tz, goal.createdAt))}`);
    if (doneTasks > 0) parts.push(`выполнено дел всего: ${doneTasks}`);
    if (logs.length > 0) {
      const byHabit = new Map<string, string[]>();
      for (const l of logs) {
        const arr = byHabit.get(l.habitId) ?? [];
        arr.push(l.date.toISOString().slice(0, 10));
        byHabit.set(l.habitId, arr);
      }
      let top: { habitId: string; len: number; ongoing: boolean } | null = null;
      for (const [habitId, ds] of byHabit) {
        const s = bestStreak(ds, today);
        if (!top || s.len > top.len) top = { habitId, ...s };
      }
      if (top && top.len >= 3) {
        const h = await prisma.habit.findUnique({ where: { id: top.habitId }, select: { name: true } });
        if (h) parts.push(`лучшая серия: «${h.name}» ${top.len} дн. подряд${top.ongoing ? ' (идёт сейчас)' : ''}`);
      }
    }
    if (parts.length === 0) return null;
    return `Вехи вашего пути (факты — вспоминай к месту, не списком): ${parts.join('; ')}.`;
  } catch (err) {
    console.warn('[journey] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
