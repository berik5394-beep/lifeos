import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { carryBudgetLimits } from './budget-carry.js';

/** Аудит 2026-11-09: лимит «на еду 50000» в ноябре — действует и в декабре. */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

describe('carryBudgetLimits', () => {
  it('последний лимит категории переходит; явный лимит месяца (даже 0) не трогаем; повтор не дублирует', async () => {
    const u = await prisma.user.create({ data: { email: `bc-${Date.now()}-${Math.random()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'UTC' } });
    const L = (category: string, monthlyLimit: number, month: number, year: number) =>
      prisma.budgetLimit.create({ data: { userId: u.id, category, monthlyLimit, month, year } });
    await L('food', 40000, 10, 2026);
    await L('food', 50000, 11, 2026); // последний — 50000
    await L('transport', 20000, 9, 2026);
    await L('fun', 15000, 11, 2026);
    await L('fun', 0, 12, 2026); // в декабре сам поставил 0

    await carryBudgetLimits(u.id, 12, 2026);
    await carryBudgetLimits(u.id, 12, 2026);
    const dec = await prisma.budgetLimit.findMany({ where: { userId: u.id, month: 12, year: 2026 }, orderBy: { category: 'asc' } });
    expect(dec.map((r) => [r.category, r.monthlyLimit])).toEqual([['food', 50000], ['fun', 0], ['transport', 20000]]);

    await carryBudgetLimits(u.id, 1, 2027); // через год
    expect(await prisma.budgetLimit.count({ where: { userId: u.id, month: 1, year: 2027 } })).toBe(3);
    // в прошлое не тянем
    await carryBudgetLimits(u.id, 8, 2026);
    expect(await prisma.budgetLimit.count({ where: { userId: u.id, month: 8, year: 2026 } })).toBe(0);
  });
});
