import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setBudgetTool } from './set-budget.js';
import { addExpenseTool } from './add-expense.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'B', passwordHash: 'x' } });
  return u.id;
}

describe('set_budget + интерконнект «предупрежу о лимите» (тест-БД)', () => {
  it('set_budget пишет BudgetLimit на текущий месяц', async () => {
    const userId = await seedUser(`sb-a-${Date.now()}@a.test`);
    await setBudgetTool.handler({ category: 'food', monthlyLimit: 50000 } as never, { userId } as never);
    const bl = await prisma.budgetLimit.findFirst({ where: { userId, category: 'food' } });
    expect(bl?.monthlyLimit).toBe(50000);
  });

  it('строковый лимит коэрсится через runRegistryTool (LLM шлёт строки)', async () => {
    const userId = await seedUser(`sb-b-${Date.now()}@a.test`);
    const { runRegistryTool } = await import('./index.js');
    await runRegistryTool('set_budget', { category: 'transport', monthlyLimit: '30000' }, { userId });
    const bl = await prisma.budgetLimit.findFirst({ where: { userId, category: 'transport' } });
    expect(bl?.monthlyLimit).toBe(30000);
  });

  it('ИНТЕРКОННЕКТ: после лимита расход сверх него даёт warning', async () => {
    const userId = await seedUser(`sb-c-${Date.now()}@a.test`);
    await setBudgetTool.handler({ category: 'food', monthlyLimit: 1000 } as never, { userId } as never);
    const res = (await addExpenseTool.handler(
      { amount: 5000, category: 'food' } as never,
      { userId } as never,
    )) as { message: string; analysis: { warning: string; budgetLimit: number } };
    expect(res.analysis.budgetLimit).toBe(1000);
    expect(res.analysis.warning).not.toBe('');
    expect(res.message).toMatch(/превыш|бюджет/i);
  });

  it('без лимита расход НЕ даёт warning (контроль)', async () => {
    const userId = await seedUser(`sb-d-${Date.now()}@a.test`);
    const res = (await addExpenseTool.handler(
      { amount: 5000, category: 'food' } as never,
      { userId } as never,
    )) as { analysis: { warning: string } };
    expect(res.analysis.warning).toBe('');
  });
});
