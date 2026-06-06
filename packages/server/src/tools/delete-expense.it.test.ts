import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deleteExpenseTool } from './delete-expense.js';

/**
 * delete_expense — РЕАЛЬНО удаляет расход + кросс-домен (пересчёт бюджета
 * в ответе). Real prisma (тест-БД), zero vi.mock. Money-safety: промах→throw,
 * cross-user изоляция.
 */
const prisma = new PrismaClient();

function mkUser(email: string) {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x' } });
}
function mkExpense(userId: string, amount: number, category: string, description: string, date = new Date('2026-06-06T00:00:00Z')) {
  return prisma.expense.create({ data: { userId, date, amount, category, description } });
}
async function del(userId: string, input: Record<string, unknown>) {
  return (await deleteExpenseTool.handler(input as never, { userId } as never)) as {
    message: string;
    deletedId: string;
  };
}

describe('delete_expense — откат расхода', () => {
  it('последний расход удаляется реально', async () => {
    const u = await mkUser('a@del.test');
    await mkExpense(u.id, 5000, 'food', 'продукты');
    const last = await mkExpense(u.id, 3000, 'transport', 'такси');
    const res = await del(u.id, { last: true });
    expect(res.deletedId).toBe(last.id);
    expect(await prisma.expense.count({ where: { userId: u.id } })).toBe(1);
    expect(res.message).toContain('3000');
  });

  it('матч по описанию удаляет нужный', async () => {
    const u = await mkUser('b@del.test');
    await mkExpense(u.id, 5000, 'food', 'продукты');
    const taxi = await mkExpense(u.id, 3000, 'transport', 'такси домой');
    const res = await del(u.id, { description: 'такси' });
    expect(res.deletedId).toBe(taxi.id);
    expect(await prisma.expense.findUnique({ where: { id: taxi.id } })).toBeNull();
  });

  it('кросс-домен: ответ содержит пересчитанный бюджет после удаления', async () => {
    const u = await mkUser('c@del.test');
    const now = new Date();
    await prisma.budgetLimit.create({
      data: { userId: u.id, category: 'food', monthlyLimit: 30000, month: now.getMonth() + 1, year: now.getFullYear() },
    });
    await mkExpense(u.id, 20000, 'food', 'большая закупка', now);
    await mkExpense(u.id, 5000, 'food', 'ещё еда', now);
    const res = await del(u.id, { amount: 5000, description: 'ещё' });
    expect(res.message).toMatch(/food/);
    expect(res.message).toMatch(/10000/); // 20000 осталось из 30000 → осталось 10000
  });

  it('нет совпадения → throws (честно, не удаляет наугад)', async () => {
    const u = await mkUser('d@del.test');
    await mkExpense(u.id, 5000, 'food', 'продукты');
    await expect(del(u.id, { description: 'кино' })).rejects.toThrow();
    expect(await prisma.expense.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cross-user: чужой расход не трогается', async () => {
    const a = await mkUser('e@del.test');
    const b = await mkUser('f@del.test');
    const bExp = await mkExpense(b.id, 5000, 'food', 'чужое');
    await expect(del(a.id, { last: true })).rejects.toThrow(); // у A нет расходов
    expect(await prisma.expense.findUnique({ where: { id: bExp.id } })).not.toBeNull();
  });
});
