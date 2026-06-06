import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { editExpenseTool } from './edit-expense.js';

const prisma = new PrismaClient();

function mkUser(email: string) {
  return prisma.user.create({ data: { email, name: 'T', passwordHash: 'x' } });
}
function mkExpense(userId: string, amount: number, category: string, description: string, date = new Date('2026-06-06T00:00:00Z')) {
  return prisma.expense.create({ data: { userId, date, amount, category, description } });
}
async function edit(userId: string, input: Record<string, unknown>) {
  return (await editExpenseTool.handler(input as never, { userId } as never)) as {
    message: string;
    editedId: string;
  };
}

describe('edit_expense — правка суммы расхода', () => {
  it('меняет сумму реально (было→стало)', async () => {
    const u = await mkUser('a@edit.test');
    const e = await mkExpense(u.id, 3000, 'food', 'продукты');
    const res = await edit(u.id, { amount: 3000, newAmount: 2000 });
    expect(res.editedId).toBe(e.id);
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))?.amount).toBe(2000);
    expect(res.message).toContain('3000');
    expect(res.message).toContain('2000');
  });

  it('last → правит последний', async () => {
    const u = await mkUser('b@edit.test');
    await mkExpense(u.id, 5000, 'food', 'старое');
    const last = await mkExpense(u.id, 3000, 'transport', 'такси');
    await edit(u.id, { last: true, newAmount: 1500 });
    expect((await prisma.expense.findUnique({ where: { id: last.id } }))?.amount).toBe(1500);
  });

  it('кросс-домен: пересчёт бюджета после правки', async () => {
    const u = await mkUser('c@edit.test');
    const now = new Date();
    await prisma.budgetLimit.create({
      data: { userId: u.id, category: 'food', monthlyLimit: 30000, month: now.getMonth() + 1, year: now.getFullYear() },
    });
    await mkExpense(u.id, 25000, 'food', 'много', now);
    const res = await edit(u.id, { amount: 25000, newAmount: 10000 });
    expect(res.message).toMatch(/20000/); // 10000 из 30000 → осталось 20000
  });

  it('нет совпадения → throws', async () => {
    const u = await mkUser('d@edit.test');
    await mkExpense(u.id, 5000, 'food', 'продукты');
    await expect(edit(u.id, { description: 'кино', newAmount: 100 })).rejects.toThrow();
    expect((await prisma.expense.findFirst({ where: { userId: u.id } }))?.amount).toBe(5000);
  });
});
