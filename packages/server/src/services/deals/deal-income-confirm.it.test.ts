import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runConfirmedAction } from '../jarvis-orchestrator.js';
import { createDeal, updateDeal, DEAL_INCOME_ACTION } from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('подтверждение дохода по сделке', () => {
  it('«Подтвердить» → Income ровно один раз', async () => {
    const u = await prisma.user.create({ data: { email: `dinc-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } });
    const { deal } = await createDeal(u.id, { personName: 'Ахмет', title: 'оборудование', amount: 2_345_678 });
    await updateDeal(u.id, deal.id, { stage: 'won' });
    const m1 = await runConfirmedAction(u.id, DEAL_INCOME_ACTION, { dealId: deal.id });
    const m2 = await runConfirmedAction(u.id, DEAL_INCOME_ACTION, { dealId: deal.id });
    expect(m1).toBe('Записал доход 2 345 678 ₸ — сделка Ахмет — оборудование.');
    expect(m2).toBe('Доход по этой сделке уже записан.');
    expect(await prisma.income.count({ where: { userId: u.id } })).toBe(1);
  });
});
