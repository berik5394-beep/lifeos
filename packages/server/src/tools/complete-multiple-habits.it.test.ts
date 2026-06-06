import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { completeMultipleHabitsTool } from './complete-multiple-habits.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'H', passwordHash: 'x' } });
  return u.id;
}

describe('complete_multiple_habits ownership (IDOR) — тест-БД', () => {
  it('чужой habitId → НЕ создаёт HabitLog у владельца, попадает в failedIds', async () => {
    const a = await seedUser(`cmh-a-${Date.now()}@a.test`);
    const b = await seedUser(`cmh-b-${Date.now()}@a.test`);
    const habitA = await prisma.habit.create({
      data: { userId: a, name: 'Бег', category: 'health', frequency: 'daily' },
    });

    const res = (await completeMultipleHabitsTool.handler(
      { habitIds: [habitA.id] } as never,
      { userId: b } as never,
    )) as { count: number; succeededIds: string[]; failedIds: string[] };

    // Главное: ни одной записи под чужой привычкой.
    const leaked = await prisma.habitLog.count({ where: { habitId: habitA.id } });
    expect(leaked).toBe(0);
    // Отмеченных нет, чужой id отражён как провал.
    expect(res.count).toBe(0);
    expect(res.succeededIds).not.toContain(habitA.id);
    expect(res.failedIds).toContain(habitA.id);
  });

  it('свой habitId → создаёт HabitLog и считается успешным', async () => {
    const a = await seedUser(`cmh-own-${Date.now()}@a.test`);
    const habit = await prisma.habit.create({
      data: { userId: a, name: 'Чтение', category: 'personal', frequency: 'daily' },
    });

    const res = (await completeMultipleHabitsTool.handler(
      { habitIds: [habit.id] } as never,
      { userId: a } as never,
    )) as { count: number; succeededIds: string[] };

    const logs = await prisma.habitLog.count({ where: { userId: a, habitId: habit.id, completed: true } });
    expect(logs).toBe(1);
    expect(res.count).toBe(1);
    expect(res.succeededIds).toContain(habit.id);
  });
});
