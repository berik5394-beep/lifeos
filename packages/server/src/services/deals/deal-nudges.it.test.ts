import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { V2ProactivityEngine } from '../v2-proactivity-engine.js';
import { createDeal, setSalesPlan } from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });
afterEach(() => { vi.useRealTimers(); });

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
  it('план есть, отстаём, 20-е число → sales_plan_behind с ключом месяца', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
    const userId = await user('plan');
    await setSalesPlan(userId, 10_000_000);
    const c = (await new V2ProactivityEngine().detectCandidates(userId)).find((x) => x.source === 'sales_plan_behind');
    expect(c).toBeDefined();
    expect(c?.entityId).toBe('sales_plan:2026-11');
  });
  it('5-е число (до 7-го дня) → sales_plan_behind нет', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
    const userId = await user('plan-early');
    await setSalesPlan(userId, 10_000_000);
    expect(await sources(userId)).not.toContain('sales_plan_behind');
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

describe('каденс sales_plan_behind (ревью I1)', () => {
  it('реальная доставка: 20-е → нудж, 24-е → нет (даже после dismiss), 28-е (≥7 дн) → снова', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
    const userId = await user('cadence');
    await setSalesPlan(userId, 10_000_000);
    const engine = new V2ProactivityEngine();
    const planRows = () => prisma.insight.count({ where: { userId, scopeKey: { startsWith: 'sales_plan_behind:' } } });

    await engine.runForUser(userId);
    expect(await planRows()).toBe(1);
    // Юзер смахнул нудж — каденс всё равно держится.
    await prisma.insight.updateMany({ where: { userId }, data: { dismissed: true } });

    vi.setSystemTime(new Date('2026-11-24T09:00:00Z'));
    await engine.runForUser(userId);
    expect(await planRows()).toBe(1);

    vi.setSystemTime(new Date('2026-11-28T09:00:00Z'));
    await engine.runForUser(userId);
    expect(await planRows()).toBe(2);
  });
});
