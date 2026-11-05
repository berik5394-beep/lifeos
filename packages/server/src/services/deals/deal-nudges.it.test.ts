import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { V2ProactivityEngine } from '../v2-proactivity-engine.js';
import { createDeal, setSalesPlan } from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  return (await prisma.user.create({ data: { email: `dn-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } })).id;
}
const sources = async (userId: string) => (await new V2ProactivityEngine().detectCandidates(userId)).map((c) => c.source);

describe('нуджи сделок', () => {
  it('шаг на сегодня/просрочен → deal_next_step_due', async () => {
    const userId = await user('due');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() - 86_400_000) } });
    expect(await sources(userId)).toContain('deal_next_step_due');
  });
  it('7+ дней тишины без будущего шага → deal_stale', async () => {
    const userId = await user('stale');
    const { deal } = await createDeal(userId, { personName: 'Серик', title: 'y' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: null, lastActivityAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await sources(userId)).toContain('deal_stale');
  });
  it('план есть, отстаём → sales_plan_behind (только с 7-го дня)', async () => {
    const userId = await user('plan');
    await setSalesPlan(userId, 10_000_000);
    const day = new Date().getUTCDate();
    const s = await sources(userId);
    if (day >= 7) expect(s).toContain('sales_plan_behind');
    else expect(s).not.toContain('sales_plan_behind');
  });
  it('флаг off → ни одного нуджа сделок', async () => {
    const userId = await user('off');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() - 86_400_000) } });
    process.env.FEATURE_V2_DEALS = '';
    const s = await sources(userId);
    expect(s.filter((x) => x.startsWith('deal_') || x === 'sales_plan_behind')).toEqual([]);
  });
});
