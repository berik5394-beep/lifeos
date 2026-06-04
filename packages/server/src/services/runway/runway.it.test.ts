import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildRunway } from './runway.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'RW', passwordHash: 'x' } });
  return u.id;
}

describe('runway buildRunway — реальная БД', () => {
  it('расход > дохода, положительный накопленный net → short/critical инсайт', async () => {
    const userId = await seedUser('rw-a@a.test');
    const now = new Date(2026, 5, 15);
    // Накопленный net положительный: разовый большой доход вне окна + расходы в окне.
    await prisma.income.create({ data: { userId, date: new Date(2026, 0, 1), source: 'sale', amount: 600000 } });
    for (const m of [3, 4, 5]) {
      await prisma.expense.create({ data: { userId, date: new Date(2026, m, 10), category: 'food', description: 'x', amount: 150000 } });
    }
    await prisma.income.create({ data: { userId, date: new Date(2026, 4, 1), source: 'work', amount: 100000 } });

    const rw = await buildRunway(userId, now);
    expect(rw).not.toBeNull();
    expect(rw!.netBurnRate).toBeGreaterThan(0);
    expect(['short', 'critical', 'underwater']).toContain(rw!.status);
    expect(rw!.insightText).toContain('мес');
  });

  it('cash-positive юзер (доход ≥ расход) → null', async () => {
    const userId = await seedUser('rw-pos@a.test');
    const now = new Date(2026, 5, 15);
    for (const m of [3, 4, 5]) {
      await prisma.income.create({ data: { userId, date: new Date(2026, m, 1), source: 'work', amount: 300000 } });
      await prisma.expense.create({ data: { userId, date: new Date(2026, m, 10), category: 'food', description: 'x', amount: 100000 } });
    }
    expect(await buildRunway(userId, now)).toBeNull();
  });

  it('cross-user: данные A не текут к B', async () => {
    const a = await seedUser('rw-iso-a@a.test');
    const b = await seedUser('rw-iso-b@a.test');
    await prisma.expense.create({ data: { userId: a, date: new Date(2026, 5, 10), category: 'food', description: 'x', amount: 200000 } });
    expect(await buildRunway(b, new Date(2026, 5, 15))).toBeNull(); // у B нет данных
  });
});
