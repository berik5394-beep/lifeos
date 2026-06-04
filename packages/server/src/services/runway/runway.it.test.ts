import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
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

describe('buildRunway — CashSnapshot anchor (реальная БД)', () => {
  const now = new Date(2026, 5, 15);
  beforeEach(() => { process.env.FEATURE_V2_RUNWAY_BALANCE = 'all'; });
  afterEach(() => { delete process.env.FEATURE_V2_RUNWAY_BALANCE; });

  it('cashOnHand = balance − расходы после asOf (расход в день asOf НЕ вычитается)', async () => {
    const userId = await seedUser('cs-a@a.test');
    const asOf = new Date(2026, 4, 1); // 1 мая
    await prisma.cashSnapshot.create({ data: { userId, balance: 500000, asOf } });
    // расход ПОСЛЕ asOf — вычитается
    await prisma.expense.create({ data: { userId, date: new Date(2026, 4, 10), category: 'food', description: 'x', amount: 120000 } });
    // расход В день asOf — НЕ вычитается (уже в балансе)
    await prisma.expense.create({ data: { userId, date: asOf, category: 'food', description: 'x', amount: 99000 } });
    const rw = await buildRunway(userId, now);
    expect(rw).not.toBeNull();
    expect(rw!.cashOnHand).toBe(380000); // 500000 − 120000
  });

  it('доход после asOf продлевает кэш', async () => {
    const userId = await seedUser('cs-b@a.test');
    const asOf = new Date(2026, 4, 1);
    await prisma.cashSnapshot.create({ data: { userId, balance: 100000, asOf } });
    await prisma.income.create({ data: { userId, date: new Date(2026, 4, 15), source: 'зп', amount: 350000 } });
    await prisma.expense.create({ data: { userId, date: new Date(2026, 4, 20), category: 'food', description: 'x', amount: 50000 } });
    const rw = await buildRunway(userId, now);
    expect(rw!.cashOnHand).toBe(400000); // 100000 + 350000 − 50000
  });

  it('без снапшота → fallback на all-time net', async () => {
    const userId = await seedUser('cs-c@a.test');
    await prisma.income.create({ data: { userId, date: new Date(2026, 4, 1), source: 'зп', amount: 100000 } });
    await prisma.expense.create({ data: { userId, date: new Date(2026, 4, 2), category: 'food', description: 'x', amount: 300000 } });
    const rw = await buildRunway(userId, now);
    expect(rw).not.toBeNull();
    expect(rw!.cashOnHand).toBe(-200000); // 100000 − 300000
  });

  it('изоляция: A не видит снапшот B', async () => {
    const a = await seedUser('cs-iso-a@a.test');
    const b = await seedUser('cs-iso-b@a.test');
    await prisma.cashSnapshot.create({ data: { userId: b, balance: 999000, asOf: new Date(2026, 4, 1) } });
    await prisma.expense.create({ data: { userId: a, date: new Date(2026, 4, 2), category: 'food', description: 'x', amount: 300000 } });
    const rwA = await buildRunway(a, now);
    expect(rwA?.cashOnHand).toBe(-300000); // A без снапшота, не 999000
  });
});
