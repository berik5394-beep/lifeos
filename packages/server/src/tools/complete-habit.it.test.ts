import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { completeHabitTool } from './complete-habit.js';
import { buildGoalHabitHealth } from '../services/goal-habits/index.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_GOAL_HABITS = 'all'; });

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'H', passwordHash: 'x' } });
  return u.id;
}

const YEAR = new Date().getUTCFullYear();

describe('complete_habit честность + кросс-домен (тест-БД)', () => {
  it('морфология: «зарядку» → реальная запись HabitLog', async () => {
    const userId = await seedUser(`hb-a-${Date.now()}@a.test`);
    const h = await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    await completeHabitTool.handler({ name: 'зарядку' } as never, { userId } as never);
    const logs = await prisma.habitLog.count({ where: { userId, habitId: h.id, completed: true } });
    expect(logs).toBe(1);
  });

  it('несуществующая привычка → THROW (не фейковый успех)', async () => {
    const userId = await seedUser(`hb-b-${Date.now()}@a.test`);
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await expect(
      completeHabitTool.handler({ name: 'плавание' } as never, { userId } as never),
    ).rejects.toThrow(/Не нашёл/);
  });

  it('привычка к цели → message содержит «к цели»', async () => {
    const userId = await seedUser(`hb-c-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Быть в форме' } });
    await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily', goalId: goal.id } });
    const res = (await completeHabitTool.handler({ name: 'зарядка' } as never, { userId } as never)) as { message: string };
    expect(res.message).toContain('к цели');
  });

  it('buildGoalHabitHealth ловит буксующую цель', async () => {
    const userId = await seedUser(`hb-d-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Форма' } });
    await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily', goalId: goal.id } });
    const health = await buildGoalHabitHealth(userId, new Date());
    expect(health).toHaveLength(1);
    expect(health[0].daysSinceLastCompletion).toBeGreaterThanOrEqual(3);
  });

  it('cross-user: B не видит цели A', async () => {
    const a = await seedUser(`hb-e1-${Date.now()}@a.test`);
    const b = await seedUser(`hb-e2-${Date.now()}@a.test`);
    const g = await prisma.yearlyGoal.create({ data: { userId: a, year: YEAR, area: 'health', goalText: 'X' } });
    await prisma.habit.create({ data: { userId: a, name: 'Бег', category: 'health', frequency: 'daily', goalId: g.id } });
    expect(await buildGoalHabitHealth(b, new Date())).toEqual([]);
  });
});
