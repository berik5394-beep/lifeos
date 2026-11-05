import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal, gatherDealsSection } from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('контекст робота: сделки', () => {
  it('открытые + шаг сегодня', async () => {
    const u = await prisma.user.create({ data: { email: `dctx-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } });
    const { deal } = await createDeal(u.id, { personName: 'Ахмет', title: 'x', amount: 2_000_000 });
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: today } });
    expect(await gatherDealsSection(u.id)).toBe('Сделки: открыто 1 на 2 млн ₸; клиенты в работе: Ахмет; шаг сегодня: Ахмет.');
  });
  it('ничего нет → null', async () => {
    const u = await prisma.user.create({ data: { email: `dctx0-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } });
    expect(await gatherDealsSection(u.id)).toBeNull();
  });
});
