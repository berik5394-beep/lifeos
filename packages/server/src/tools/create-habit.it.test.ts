import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHabitTool } from './create-habit.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'CH', passwordHash: 'x' } });
  return u.id;
}

const YEAR = new Date().getUTCFullYear();

describe('create_habit реально пишет + кросс-домен привычка↔цель (тест-БД)', () => {
  it('создаёт привычку → реальная запись Habit', async () => {
    const userId = await seedUser(`ch-a-${Date.now()}@a.test`);
    const res = (await createHabitTool.handler({ name: 'Зарядка' } as never, { userId } as never)) as { habitId: string };
    const h = await prisma.habit.findFirst({ where: { userId, name: 'Зарядка', active: true } });
    expect(h?.id).toBe(res.habitId);
    expect(h?.category).toBe('personal');
    expect(h?.frequency).toBe('daily');
  });

  it('дубль не плодит вторую привычку (морфология)', async () => {
    const userId = await seedUser(`ch-b-${Date.now()}@a.test`);
    await createHabitTool.handler({ name: 'Зарядка' } as never, { userId } as never);
    const res = (await createHabitTool.handler({ name: 'зарядку' } as never, { userId } as never)) as { existed?: boolean };
    expect(res.existed).toBe(true);
    expect(await prisma.habit.count({ where: { userId, active: true } })).toBe(1);
  });

  it('кросс-домен: привязка к цели по имени выставляет goalId', async () => {
    const userId = await seedUser(`ch-c-${Date.now()}@a.test`);
    const goal = await prisma.yearlyGoal.create({ data: { userId, year: YEAR, area: 'health', goalText: 'Быть в форме' } });
    const res = (await createHabitTool.handler({ name: 'Бег', goal: 'быть в форме' } as never, { userId } as never)) as { habitId: string; goalId?: string };
    expect(res.goalId).toBe(goal.id);
    const h = await prisma.habit.findUnique({ where: { id: res.habitId } });
    expect(h?.goalId).toBe(goal.id);
  });

  it('категория валидируется (мусор → personal)', async () => {
    const userId = await seedUser(`ch-d-${Date.now()}@a.test`);
    const res = (await createHabitTool.handler({ name: 'Чтение', category: 'выдуманная' } as never, { userId } as never)) as { habitId: string };
    const h = await prisma.habit.findUnique({ where: { id: res.habitId } });
    expect(h?.category).toBe('personal');
  });

  it('cross-user: B не привязывает привычку к цели A', async () => {
    const a = await seedUser(`ch-e1-${Date.now()}@a.test`);
    const b = await seedUser(`ch-e2-${Date.now()}@a.test`);
    await prisma.yearlyGoal.create({ data: { userId: a, year: YEAR, area: 'health', goalText: 'Марафон' } });
    const res = (await createHabitTool.handler({ name: 'Бег', goal: 'марафон' } as never, { userId: b } as never)) as { goalId?: string };
    expect(res.goalId).toBeUndefined();
  });

  it('строковые поля проходят через runRegistryTool', async () => {
    const userId = await seedUser(`ch-f-${Date.now()}@a.test`);
    const { runRegistryTool } = await import('./index.js');
    await runRegistryTool('create_habit', { name: 'Медитация' }, { userId });
    expect(await prisma.habit.count({ where: { userId, name: 'Медитация' } })).toBe(1);
  });
});
