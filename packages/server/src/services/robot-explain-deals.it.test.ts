import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { gatherPanelFacts, explainPanel, factsFallback } from './robot-explain.js';
import { createDeal } from './deals/service.js';

/** Нит ревью: панель «Сделки» — факты из БД. */
const prisma = new PrismaClient();
const ORIG_KEY = process.env.CLAUDE_API_KEY;
afterAll(async () => {
  if (ORIG_KEY === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = ORIG_KEY;
  await prisma.$disconnect();
});
beforeEach(() => {
  delete process.env.CLAUDE_API_KEY; // без ИИ — ответ из фактов
});

async function userWithDeal(tag: string) {
  const u = await prisma.user.create({ data: { email: `rxd-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } });
  await createDeal(u.id, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 });
  return u.id;
}

describe('пояснение робота: панель «Сделки»', () => {
  it('есть открытая сделка → факт со сделкой, ответ из фактов', async () => {
    const userId = await userWithDeal('on');
    const facts = await gatherPanelFacts(userId, 'deals');
    expect(facts.join(' ')).toMatch(/Ахмет/);
    expect(facts.join(' ')).toMatch(/2 млн ₸/);
    const ex = await explainPanel(userId, 'deals');
    expect(ex.source).toBe('facts');
    expect(ex.text).toMatch(/Ахмет/);
  });

});
