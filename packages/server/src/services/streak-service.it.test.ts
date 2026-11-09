import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { calculateStreak } from './streak-service.js';
import { civilDayRefs, addCivilDays } from '../lib/tz.js';

/** Аудит 2026-11-09: серия обнулялась после первой утренней отметки; недельные ломали порог. */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

async function userWith(daily: number, weekly: number) {
  const u = await prisma.user.create({ data: { email: `st-${Date.now()}-${Math.random()}@a.test`, name: 'S', passwordHash: 'x', timezone: 'UTC' } });
  const mk = (i: number, frequency: string) => prisma.habit.create({ data: { userId: u.id, name: `h${frequency}${i}`, category: 'health', frequency } });
  const habits = [
    ...(await Promise.all(Array.from({ length: daily }, (_, i) => mk(i, 'daily')))),
    ...(await Promise.all(Array.from({ length: weekly }, (_, i) => mk(i, 'weekly')))),
  ];
  return { userId: u.id, habits };
}
const log = (userId: string, habitId: string, day: string) =>
  prisma.habitLog.create({ data: { userId, habitId, date: new Date(`${day}T00:00:00Z`), completed: true } });

describe('calculateStreak', () => {
  it('3 полных дня + сегодня 1 из 4 → серия 3, а не 0', async () => {
    const { userId, habits } = await userWith(4, 0);
    const today = civilDayRefs('UTC').today;
    for (let d = 1; d <= 3; d++) for (const h of habits) await log(userId, h.id, addCivilDays(today, -d));
    await log(userId, habits[0].id, today);
    expect(await calculateStreak(userId, 'UTC')).toBe(3);
  });

  it('недельная привычка не обязана быть каждый день', async () => {
    const { userId, habits } = await userWith(1, 1);
    const today = civilDayRefs('UTC').today;
    for (let d = 0; d <= 2; d++) await log(userId, habits[0].id, addCivilDays(today, -d));
    expect(await calculateStreak(userId, 'UTC')).toBe(3);
  });
});
