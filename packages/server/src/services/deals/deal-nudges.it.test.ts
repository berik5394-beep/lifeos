import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { V2ProactivityEngine } from '../v2-proactivity-engine.js';
import { createDeal, setSalesPlan } from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
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
  it('просроченный шаг + 8 дн тишины → только deal_next_step_due, без deal_stale (ревью: двойное напоминание)', async () => {
    const userId = await user('stale-overdue');
    const { deal } = await createDeal(userId, { personName: 'Серик', title: 'y' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() - 2 * 86_400_000), lastActivityAt: new Date(Date.now() - 8 * 86_400_000) } });
    const s = await sources(userId);
    expect(s).toContain('deal_next_step_due');
    expect(s).not.toContain('deal_stale');
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

describe('ключ deal_next_step_due (ревью I2)', () => {
  const D = (civil: string) => new Date(`${civil}T00:00:00Z`);
  const dueRows = (userId: string) => prisma.insight.count({ where: { userId, scopeKey: { startsWith: 'deal_next_step_due:' } } });

  it('A просрочена и напомнена; назавтра наступает шаг B → нудж снова; повтор в тот же день — нет', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
    const userId = await user('due-b');
    const engine = new V2ProactivityEngine();
    const a = (await createDeal(userId, { personName: 'Ахмет', title: 'a' })).deal;
    const b = (await createDeal(userId, { personName: 'Серик', title: 'b' })).deal;
    await prisma.deal.update({ where: { id: a.id }, data: { nextStepAt: D('2026-11-01') } });
    await prisma.deal.update({ where: { id: b.id }, data: { nextStepAt: D('2026-11-03') } });

    await engine.runForUser(userId);
    expect(await dueRows(userId)).toBe(1);
    await engine.runForUser(userId); // тот же день — дедуп
    expect(await dueRows(userId)).toBe(1);

    vi.setSystemTime(new Date('2026-11-03T09:00:00Z'));
    await engine.runForUser(userId);
    expect(await dueRows(userId)).toBe(2);
  });

  it('A напомнена в понедельник, юзер перенёс шаг на среду → в среду нудж', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T09:00:00Z')); // понедельник
    const userId = await user('due-move');
    const engine = new V2ProactivityEngine();
    const a = (await createDeal(userId, { personName: 'Ахмет', title: 'a' })).deal;
    await prisma.deal.update({ where: { id: a.id }, data: { nextStepAt: D('2026-11-02') } });
    await engine.runForUser(userId);
    expect(await dueRows(userId)).toBe(1);

    await prisma.deal.update({ where: { id: a.id }, data: { nextStepAt: D('2026-11-04') } });
    vi.setSystemTime(new Date('2026-11-04T09:00:00Z')); // среда
    await engine.runForUser(userId);
    expect(await dueRows(userId)).toBe(2);
  });
});

describe('просрочка шага: due 1–2 дня, дальше — «шаг просрочен» раз в неделю (ревью I-a, ревью-3 N7)', () => {
  const D = (civil: string) => new Date(`${civil}T00:00:00Z`);
  const rows = (userId: string, src: string) => prisma.insight.count({ where: { userId, scopeKey: { startsWith: `${src}:` } } });
  const prevDay = (civil: string) => new Date(D(civil).getTime() - 86_400_000).toISOString().slice(0, 10);

  it.each([
    // UTC, утро: «сегодня» = дата UTC
    { tz: 'UTC', at: (day: string) => new Date(`${day}T09:00:00Z`) },
    // Алматы (UTC+5), 20:00 UTC = 01:00 СЛЕДУЮЩЕГО дня по Алматы: дата юзера ≠ дата UTC
    // (подъём в 01:00 — иначе тихие часы gate1 не пропустят нудж)
    { tz: 'Asia/Almaty', at: (day: string) => new Date(`${prevDay(day)}T20:00:00Z`) },
  ])('$tz: шаг 04.11: 04–06 → deal_next_step_due; 07 → deal_step_overdue; 08/10 — тишина; 14 — снова', async ({ tz, at }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-02'));
    const u = await prisma.user.create({
      data: { email: `dn-cycle-${tz}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: tz, wakeUpTime: '01:00' },
    });
    const userId = u.id;
    const engine = new V2ProactivityEngine();
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: D('2026-11-04') } });

    const expectAt = async (day: string, due: number, overdue: number) => {
      vi.setSystemTime(at(day));
      await engine.runForUser(userId);
      expect({
        day,
        due: await rows(userId, 'deal_next_step_due'),
        overdue: await rows(userId, 'deal_step_overdue'),
        stale: await rows(userId, 'deal_stale'),
      }).toEqual({ day, due, overdue, stale: 0 });
    };
    await expectAt('2026-11-04', 1, 0); // сегодня
    await expectAt('2026-11-05', 2, 0); // просрочка 1
    await expectAt('2026-11-06', 3, 0); // просрочка 2
    await expectAt('2026-11-07', 3, 1); // просрочка 3 → «шаг просрочен», не «пора»
    await expectAt('2026-11-08', 3, 1); // не каждый день
    await expectAt('2026-11-10', 3, 1); // R10 стора (3 дня) прошёл — всё равно неделя
    await expectAt('2026-11-14', 3, 2); // неделя прошла
  });

  it('детектор: просрочка ≥3 дней → deal_step_overdue с текстом про шаг, без deal_next_step_due и deal_stale', async () => {
    const userId = await user('overdue3');
    const { deal } = await createDeal(userId, { personName: 'Серик', title: 'склад' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() - 4 * 86_400_000) } });
    const cands = await new V2ProactivityEngine().detectCandidates(userId);
    expect(cands.map((c) => c.source)).not.toContain('deal_next_step_due');
    expect(cands.map((c) => c.source)).not.toContain('deal_stale');
    const st = cands.find((c) => c.source === 'deal_step_overdue');
    expect(st?.entityId).toBe(deal.id);
    expect(st?.significance).toBe(0.6);
    expect(String(st?.payload.overdueText)).toMatch(/Шаг по сделке «склад» с Сериком просрочен на 4 дн/);
  });

  it('шаг завтра + 8 дн тишины → не «затихла» (шаг назначен)', async () => {
    const userId = await user('future-step');
    const { deal } = await createDeal(userId, { personName: 'Серик', title: 'склад' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() + 86_400_000), lastActivityAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await sources(userId)).not.toContain('deal_stale');
  });

  it('нит: ключ deals_due — хэш набора (16 hex) + дата, не список id', async () => {
    const userId = await user('due-hash');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x' });
    await prisma.deal.update({ where: { id: deal.id }, data: { nextStepAt: new Date(Date.now() - 86_400_000) } });
    const c = (await new V2ProactivityEngine().detectCandidates(userId)).find((x) => x.source === 'deal_next_step_due');
    expect(c?.entityId).toMatch(/^deals_due:[0-9a-f]{16}:\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ревью-3 N8: один нудж за прогон, не чаще раза в 2 дня на источник', () => {
  const D = (civil: string) => new Date(`${civil}T00:00:00Z`);
  const rows = (userId: string, src: string) => prisma.insight.findMany({ where: { userId, scopeKey: { startsWith: `${src}:` } }, select: { scopeKey: true } });
  const cands = async (userId: string, src: string) =>
    (await new V2ProactivityEngine().detectCandidates(userId)).filter((c) => c.source === src);

  it('несколько просроченных → один кандидат: крупнейшая сумма, при равной — старейший шаг', async () => {
    const userId = await user('n8-overdue');
    const small = (await createDeal(userId, { personName: 'Ахмет', title: 'a', amount: 1_000_000 })).deal;
    const big = (await createDeal(userId, { personName: 'Серик', title: 'b', amount: 5_000_000 })).deal;
    const bigNewer = (await createDeal(userId, { personName: 'Дана', title: 'c', amount: 5_000_000 })).deal;
    await prisma.deal.update({ where: { id: small.id }, data: { nextStepAt: new Date(Date.now() - 10 * 86_400_000) } });
    await prisma.deal.update({ where: { id: big.id }, data: { nextStepAt: new Date(Date.now() - 6 * 86_400_000) } });
    await prisma.deal.update({ where: { id: bigNewer.id }, data: { nextStepAt: new Date(Date.now() - 4 * 86_400_000) } });
    const c = await cands(userId, 'deal_step_overdue');
    expect(c.map((x) => x.entityId)).toEqual([big.id]);
  });

  it('несколько затихших → один кандидат: крупнейшая сумма, при равной — дольше молчит', async () => {
    const userId = await user('n8-stale');
    const a = (await createDeal(userId, { personName: 'Ахмет', title: 'a', amount: 1_000_000 })).deal;
    const b = (await createDeal(userId, { personName: 'Серик', title: 'b', amount: 3_000_000 })).deal;
    const c2 = (await createDeal(userId, { personName: 'Дана', title: 'c', amount: 3_000_000 })).deal;
    await prisma.deal.update({ where: { id: a.id }, data: { nextStepAt: null, lastActivityAt: new Date(Date.now() - 20 * 86_400_000) } });
    await prisma.deal.update({ where: { id: b.id }, data: { nextStepAt: null, lastActivityAt: new Date(Date.now() - 9 * 86_400_000) } });
    await prisma.deal.update({ where: { id: c2.id }, data: { nextStepAt: null, lastActivityAt: new Date(Date.now() - 12 * 86_400_000) } });
    const c = await cands(userId, 'deal_stale');
    expect(c.map((x) => x.entityId)).toEqual([c2.id]);
  });

  it('просрочка: A напомнена → на следующий день B (другая сделка) молчит, через 2 дня — B', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
    const userId = await user('n8-window');
    const engine = new V2ProactivityEngine();
    const a = (await createDeal(userId, { personName: 'Ахмет', title: 'a', amount: 5_000_000 })).deal;
    const b = (await createDeal(userId, { personName: 'Серик', title: 'b', amount: 1_000_000 })).deal;
    await prisma.deal.update({ where: { id: a.id }, data: { nextStepAt: D('2026-11-05') } });
    await prisma.deal.update({ where: { id: b.id }, data: { nextStepAt: D('2026-11-06') } });

    await engine.runForUser(userId);
    expect((await rows(userId, 'deal_step_overdue')).map((r) => r.scopeKey)).toEqual([`deal_step_overdue:${a.id}`]);

    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    expect(await cands(userId, 'deal_step_overdue')).toEqual([]);
    await engine.runForUser(userId);
    expect(await rows(userId, 'deal_step_overdue')).toHaveLength(1);

    vi.setSystemTime(new Date('2026-11-12T09:30:00Z'));
    await engine.runForUser(userId);
    expect((await rows(userId, 'deal_step_overdue')).map((r) => r.scopeKey).sort()).toEqual(
      [`deal_step_overdue:${a.id}`, `deal_step_overdue:${b.id}`].sort(),
    );
  });

  it('затихла: тот же 2-дневный порог на источник', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:00:00Z'));
    const userId = await user('n8-stale-window');
    const engine = new V2ProactivityEngine();
    const a = (await createDeal(userId, { personName: 'Ахмет', title: 'a', amount: 5_000_000 })).deal;
    const b = (await createDeal(userId, { personName: 'Серик', title: 'b', amount: 1_000_000 })).deal;
    const old = new Date('2026-11-01T09:00:00Z');
    await prisma.deal.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { nextStepAt: null, lastActivityAt: old } });
    await engine.runForUser(userId);
    expect((await rows(userId, 'deal_stale')).map((r) => r.scopeKey)).toEqual([`deal_stale:${a.id}`]);
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    expect(await cands(userId, 'deal_stale')).toEqual([]);
    vi.setSystemTime(new Date('2026-11-12T09:30:00Z'));
    expect((await cands(userId, 'deal_stale')).map((c) => c.entityId)).toEqual([b.id]);
  });
});
