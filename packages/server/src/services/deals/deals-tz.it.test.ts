import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { V2ProactivityEngine } from '../v2-proactivity-engine.js';
import { createDeal, updateDeal, gatherDealsSection, setSalesPlan, salesPlanStatus } from './service.js';

// Ревью Nit 12: юзер в Алматы (+5). «Сегодня» — по его календарю, не по UTC сервера.
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });
afterEach(() => { vi.useRealTimers(); });

async function almatyUser(tag: string) {
  return (await prisma.user.create({ data: { email: `dtz-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'Asia/Almaty' } })).id;
}
const dueCandidate = async (userId: string) =>
  (await new V2ProactivityEngine().detectCandidates(userId)).find((c) => c.source === 'deal_next_step_due');

describe('сделки × часовой пояс (Asia/Almaty, +5)', () => {
  // UTC 2026-11-10 19:30 = Алматы 2026-11-11 00:30 (UTC-дата ещё «10-е»).
  it('сразу после местной полуночи: шаг на местное «сегодня» — сегодня, «завтра» — нет', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T19:30:00Z'));
    const userId = await almatyUser('after-midnight');
    await createDeal(userId, { personName: 'Ахмет', title: 'a', nextStepDate: '2026-11-11', nextStepText: 'позвонить' });
    await createDeal(userId, { personName: 'Серик', title: 'b', nextStepDate: '2026-11-12', nextStepText: 'КП' });

    const c = await dueCandidate(userId);
    expect(c?.payload.list).toBe('Ахмет — позвонить');
    expect(c?.entityId).toMatch(/:2026-11-11$/);
    const ctx = await gatherDealsSection(userId);
    expect(ctx).toContain('шаг сегодня: Ахмет');
    expect(ctx).not.toContain('просрочен');
    expect(ctx).not.toContain('шаг сегодня: Ахмет, Серик');
  });

  // UTC 2026-11-11 18:50 = Алматы 2026-11-11 23:50 — ещё «сегодня», шаг на 11-е не просрочен.
  it('перед местной полуночью: шаг на «сегодня» — сегодня (не просрочен), завтрашний — нет', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T18:50:00Z'));
    const userId = await almatyUser('before-midnight');
    await createDeal(userId, { personName: 'Ахмет', title: 'a', nextStepDate: '2026-11-11', nextStepText: 'позвонить' });
    await createDeal(userId, { personName: 'Серик', title: 'b', nextStepDate: '2026-11-12', nextStepText: 'КП' });

    const c = await dueCandidate(userId);
    expect(c?.payload.list).toBe('Ахмет — позвонить');
    expect(c?.entityId).toMatch(/:2026-11-11$/);
    const ctx = await gatherDealsSection(userId);
    expect(ctx).toContain('шаг сегодня: Ахмет');
    expect(ctx).not.toContain('просрочен');
  });

  it('выиграна в 00:30 по Алматы 1-го → в план нового месяца, не прошлого', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T06:00:00Z'));
    const userId = await almatyUser('won-first');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'a', amount: 3_000_000 });

    const wonAt = new Date('2026-11-30T19:30:00Z'); // Алматы 2026-12-01 00:30
    vi.setSystemTime(wonAt);
    await updateDeal(userId, deal.id, { stage: 'won' }, wonAt);
    await setSalesPlan(userId, 10_000_000, wonAt); // план декабря (по Алматы уже 1-е)
    await setSalesPlan(userId, 10_000_000, wonAt, '2026-11');

    const dec = await salesPlanStatus(userId, wonAt);
    expect(dec?.won).toBe(3_000_000);
    const nov = await salesPlanStatus(userId, wonAt, '2026-11');
    expect(nov?.won).toBe(0);
  });
});
