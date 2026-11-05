import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRegistryTool } from './index.js';
import { peekPendingAction } from '../services/pending-actions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dtool-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}
type Out = { message?: string; error?: string; ask?: string[] };

describe('инструменты сделок', () => {
  it('create_deal → сделка и текст с шагом', async () => {
    const userId = await user('c');
    const out = (await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, { userId })) as Out;
    expect(out.message).toMatch(/^Записал сделку: Ахмет — оборудование, 2 млн ₸/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(1);
  });

  it('update_deal: две открытые у клиента → переспрос, ничего не меняем', async () => {
    const userId = await user('ask');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование' }, { userId });
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'сервис' }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', stage: 'proposal' }, { userId })) as Out;
    expect(out.message).toMatch(/У Ахмета 2 открытые сделки/);
    expect(await prisma.deal.count({ where: { userId, stage: 'proposal' } })).toBe(0);
  });

  it('ревью I6: неточное название единственной сделки → обновляем её, не «нет сделки»', async () => {
    const userId = await user('tie');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование' }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', title: 'оборудования', stage: 'proposal' }, { userId })) as Out;
    expect(out.message).toMatch(/^Сделка Ахмет — оборудование: стадия «КП отправлено»/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(1);
  });

  it('update_deal won с суммой → pending record_deal_income', async () => {
    const userId = await user('won');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', stage: 'оплатил' }, { userId })) as Out;
    expect(out.message).toMatch(/Записать доход 2 млн ₸ от Ахмета\?/);
    const p = await peekPendingAction(userId);
    expect(p?.action).toBe('record_deal_income');
  });

  it('update_deal без сделки → предлагает завести', async () => {
    const userId = await user('none');
    const out = (await runRegistryTool('update_deal', { personName: 'Дана', stage: 'proposal' }, { userId })) as Out;
    expect(out.message).toMatch(/С Даной открытых сделок нет/);
  });

  it('list_deals и set_sales_plan', async () => {
    const userId = await user('list');
    await runRegistryTool('set_sales_plan', { amount: 10_000_000 }, { userId });
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'x', amount: 3_000_000 }, { userId });
    const out = (await runRegistryTool('list_deals', {}, { userId })) as Out;
    expect(out.message).toContain('Открыто 1 сделка на 3 млн ₸');
    expect(out.message).toContain('План месяца 10 млн ₸');
  });

  it.each([
    ['create_deal', { personName: 'Ахмет' }],
    ['update_deal', { personName: 'Ахмет', nextStepDate: '2026-11-10' }],
    ['list_deals', {}],
    ['set_sales_plan', { amount: 1000 }],
  ] as const)('флаг off → %s говорит агенту, чем заменить', async (tool, args) => {
    process.env.FEATURE_V2_DEALS = '';
    const userId = await user(`off-${tool}`);
    const out = (await runRegistryTool(tool, { ...args }, { userId })) as Out & { hint?: string };
    expect(out.error).toBe('deals_disabled');
    expect(out.hint).toMatch(/^сделки выключены — /);
    if (tool === 'update_deal') expect(out.hint).toMatch(/create_task.*create_obligation/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(0);
  });
});
