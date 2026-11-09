import { prisma } from './prisma.js';

/**
 * «Человек был в приложении сегодня» (UTC-день) — один insert на человека в
 * день: в памяти помним, кого уже отметили. Нужен для удержания (вернулся ли
 * на следующий день / через неделю) и стоимости моделей на активного человека.
 */
const marked = new Set<string>();

export function markActiveDay(userId: string, now: Date = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  const key = `${userId}|${day}`;
  if (marked.has(key)) return;
  marked.add(key);
  if (marked.size > 50_000) marked.clear(); // память не растёт бесконечно; повтор — безобидный upsert
  void prisma.userActiveDay
    .upsert({ where: { userId_day: { userId, day: new Date(day) } }, create: { userId, day: new Date(day) }, update: {} })
    .catch((err) => {
      marked.delete(key);
      console.warn('[active-day] mark failed:', err instanceof Error ? err.message : err);
    });
}
