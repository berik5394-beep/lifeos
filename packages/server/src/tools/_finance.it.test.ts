import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { analyzeBudgetAfterExpense } from './_finance.js';

const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});
const TZ = 'Asia/Almaty'; // +5, без DST — civil-месяц юзера ≠ месяц UTC первые 5ч каждого месяца
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `it-fin-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: TZ },
  });
  return u.id;
}

describe('analyzeBudgetAfterExpense — месяц ЮЗЕРА, не сервера (R9 TZ)', () => {
  it('граница месяца: 1 июля 01:00 Алматы (= 30 июня 20:00 UTC) → лимит/расходы ИЮЛЯ юзера', async () => {
    const uid = await mkUser(`b-${Date.now()}`);
    // Лимит на ИЮЛЬ (как пишет set_budget — месяцем юзера)
    await prisma.budgetLimit.create({
      data: { userId: uid, category: 'food', monthlyLimit: 10_000, month: 7, year: 2026 },
    });
    // Расход 1 июля Алматы (add-expense пишет date=localDayStartUTC → 2026-06-30T19:00Z)
    await prisma.expense.create({
      data: {
        userId: uid,
        category: 'food',
        description: 'продукты',
        amount: 9_000,
        date: new Date('2026-06-30T19:00:00.000Z'),
      },
    });
    // «Сейчас» = 2026-07-01 01:00 Алматы = 2026-06-30T20:00Z (сервер ещё в июне!)
    const now = new Date('2026-06-30T20:00:00.000Z');
    const a = await analyzeBudgetAfterExpense(uid, 'food', now);
    expect(a.budgetLimit).toBe(10_000); // старый код искал month=6 → 0
    expect(a.spent).toBe(9_000); // старый код считал июнь сервера → 0
    expect(Math.round(a.percentage)).toBe(90);
    expect(a.warning).toContain('90');
    expect(a.daysLeft).toBe(30); // июль: 31 − 1
  });

  it('середина месяца: обычный случай работает (контроль)', async () => {
    const uid = await mkUser(`m-${Date.now()}`);
    await prisma.budgetLimit.create({
      data: { userId: uid, category: 'food', monthlyLimit: 10_000, month: 7, year: 2026 },
    });
    // Расход 10 июля Алматы (convB instant = 2026-07-09T19:00Z)
    await prisma.expense.create({
      data: {
        userId: uid,
        category: 'food',
        description: 'обед',
        amount: 5_000,
        date: new Date('2026-07-09T19:00:00.000Z'),
      },
    });
    const now = new Date('2026-07-15T10:00:00.000Z'); // 15:00 Алматы, 15 июля
    const a = await analyzeBudgetAfterExpense(uid, 'food', now);
    expect(a.budgetLimit).toBe(10_000);
    expect(a.spent).toBe(5_000);
    expect(a.warning).toBe(''); // 50% — без предупреждения
    expect(a.daysLeft).toBe(16); // 31 − 15
  });

  it('cross-user: чужие расходы/лимиты не считаются', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    const u2 = await mkUser(`x2-${Date.now()}`);
    await prisma.budgetLimit.create({
      data: { userId: u2, category: 'food', monthlyLimit: 10_000, month: 7, year: 2026 },
    });
    await prisma.expense.create({
      data: {
        userId: u2,
        category: 'food',
        description: 'чужое',
        amount: 9_000,
        date: new Date('2026-07-09T19:00:00.000Z'),
      },
    });
    const now = new Date('2026-07-15T10:00:00.000Z');
    const a = await analyzeBudgetAfterExpense(u1, 'food', now);
    expect(a.budgetLimit).toBe(0);
    expect(a.spent).toBe(0);
    expect(a.warning).toBe('');
  });
});
