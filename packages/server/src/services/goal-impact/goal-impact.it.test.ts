import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildGoalImpact } from './goal-impact.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const YEAR = new Date().getFullYear();

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email, name: 'GI', passwordHash: 'x' },
  });
  return u.id;
}

describe('goal-impact buildGoalImpact — реальная БД', () => {
  it('денежная цель позади + траты + долг → числовой инсайт', async () => {
    const userId = await seedUser('gi-a@a.test');
    const now = new Date(YEAR, 5, 4); // 4 июня — есть месяцы до конца года
    // Финансовая годовая цель, большой target, малый прогресс → behind.
    await prisma.yearlyGoal.create({
      data: {
        userId,
        year: YEAR,
        area: 'finance',
        goalText: 'миллион',
        target: 1_000_000,
        progress: 5,
      },
    });
    // Доход/расход за окно: capacity = (300k-100k)/3 ≈ 66k < requiredAnchor.
    await prisma.income.create({
      data: { userId, date: now, source: 'work', amount: 300_000 },
    });
    await prisma.expense.create({
      data: { userId, date: now, category: 'food', description: 'доставка', amount: 80_000 },
    });
    await prisma.expense.create({
      data: { userId, date: now, category: 'transport', description: 'такси', amount: 20_000 },
    });
    await prisma.obligation.create({
      data: {
        userId,
        personName: 'Ахмет',
        personEntityId: null,
        direction: 'i_owe',
        kind: 'money',
        amount: 500_000,
        description: 'долг',
        source: 'manual',
      },
    });

    const gi = await buildGoalImpact(userId, now);
    expect(gi).not.toBeNull();
    expect(gi!.goalText).toBe('миллион');
    expect(gi!.requiredMonthly).toBeGreaterThan(0);
    expect(gi!.topCategory?.category).toBe('food'); // 80k > 20k
    expect(gi!.totalOwed).toBe(500_000);
    expect(gi!.insightText).toContain('миллион');
  });

  it('нет финансовой цели → null', async () => {
    const userId = await seedUser('gi-none@a.test');
    expect(await buildGoalImpact(userId, new Date(YEAR, 5, 4))).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('gi-iso-a@a.test');
    const b = await seedUser('gi-iso-b@a.test');
    await prisma.yearlyGoal.create({
      data: { userId: a, year: YEAR, area: 'finance', goalText: 'A-цель', target: 1_000_000, progress: 1 },
    });
    await prisma.expense.create({
      data: { userId: a, date: new Date(YEAR, 5, 4), category: 'food', description: 'x', amount: 90_000 },
    });
    const giB = await buildGoalImpact(b, new Date(YEAR, 5, 4));
    expect(giB).toBeNull(); // у B нет цели/трат
  });
});
