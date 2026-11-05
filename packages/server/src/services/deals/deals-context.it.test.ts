import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal, gatherDealsSection, setSalesPlan } from './service.js';

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

describe('контекст робота: план продаж ↔ денежная цель', () => {
  const NOW = new Date();
  const year = NOW.getFullYear();
  async function u(tag: string) {
    return (await prisma.user.create({ data: { email: `dsav-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } })).id;
  }
  const goal = (userId: string) =>
    prisma.yearlyGoal.create({
      data: { userId, year, area: 'finance', goalText: 'Квартира', target: 6_000_000, targetDate: new Date(NOW.getTime() + 365 * 86_400_000) },
    });

  it('план + денежная цель → одна честная строка (выручка ≠ накопления)', async () => {
    const userId = await u('both');
    await setSalesPlan(userId, 10_000_000, NOW);
    await goal(userId);
    const s = await gatherDealsSection(userId, NOW);
    expect(s).toMatch(/План продаж 10 млн ₸\/мес — это выручка, а не накопления: чтобы успеть к цели «Квартира», откладывать нужно ~[\d ]+ ₸\/мес\.\.$/);
  });

  it('цель есть, плана нет → строки нет', async () => {
    const userId = await u('noplan');
    await goal(userId);
    await createDeal(userId, { personName: 'Ахмет', title: 'x', amount: 2_000_000 }, NOW);
    const s = await gatherDealsSection(userId, NOW);
    expect(s).not.toContain('выручка');
    expect(s).toBe('Сделки: открыто 1 на 2 млн ₸; клиенты в работе: Ахмет.');
  });

  it('план есть, денежной цели нет → строки нет', async () => {
    const userId = await u('nogoal');
    await setSalesPlan(userId, 10_000_000, NOW);
    expect(await gatherDealsSection(userId, NOW)).not.toContain('выручка');
  });
});
