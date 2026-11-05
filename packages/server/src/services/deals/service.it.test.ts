import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createDeal, findOpenDeals, updateDeal, recordDealIncome, setSalesPlan, salesPlanStatus, listDeals,
} from './service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `deals-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}
const NOW = new Date('2026-11-05T09:00:00Z');

describe('сервис сделок', () => {
  it('создание: клиент заведён и отмечен, шаг по умолчанию, событие', async () => {
    const userId = await user('create');
    const r = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, NOW);
    expect(r.taggedClient).toBe(true);
    expect(r.step).toEqual({ date: '2026-11-07', text: 'связаться' });
    expect(r.deal.personEntityId).toBeTruthy();
    const ent = await prisma.entity.findUnique({ where: { id: r.deal.personEntityId! } });
    expect((ent?.attributes as Record<string, unknown>).personType).toBe('client');
    expect(await prisma.dealEvent.count({ where: { dealId: r.deal.id, kind: 'created' } })).toBe(1);
  });

  it('уже есть тип (партнёр) — не перезаписываем', async () => {
    const userId = await user('typed');
    await prisma.entity.create({ data: { userId, type: 'person', name: 'Серик', attributes: { personType: 'partner' } } });
    const r = await createDeal(userId, { personName: 'Серик', title: 'склад' }, NOW);
    expect(r.taggedClient).toBe(false);
  });

  it('поиск открытых: по имени, с уточнением названия', async () => {
    const userId = await user('find');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' }, NOW);
    await createDeal(userId, { personName: 'Ахмет', title: 'сервис' }, NOW);
    expect(await findOpenDeals(userId, 'Ахмет')).toHaveLength(2);
    expect(await findOpenDeals(userId, 'Ахмет', 'сервис')).toHaveLength(1);
    expect(await findOpenDeals(userId, 'Дана')).toHaveLength(0);
  });

  it('ревью I6: название — только развязка при >1, не фильтр', async () => {
    const userId = await user('tie');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' }, NOW);
    // одна сделка: неточное название не прячет её (раньше → «нет сделки» → дубль)
    expect(await findOpenDeals(userId, 'Ахмет', 'оборудования для склада')).toHaveLength(1);
    expect(await findOpenDeals(userId, 'Ахмет', 'склад')).toHaveLength(1);
    await createDeal(userId, { personName: 'Ахмет', title: 'сервис' }, NOW);
    // две: развязка по общему корню ≥5 букв / вхождению в любую сторону
    const byStem = await findOpenDeals(userId, 'Ахмет', 'сервисное обслуживание');
    expect(byStem.map((d) => d.title)).toEqual(['сервис']);
    expect((await findOpenDeals(userId, 'Ахмет', 'ОБОРУДОВАНИЕ')).map((d) => d.title)).toEqual(['оборудование']);
    // развязка ничего не дала → все (инструмент переспросит списком)
    expect(await findOpenDeals(userId, 'Ахмет', 'склад')).toHaveLength(2);
  });

  it('смена стадии: шаг по умолчанию, события, won → предложение дохода', async () => {
    const userId = await user('stage');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, NOW);
    const r1 = await updateDeal(userId, deal.id, { stage: 'proposal' }, NOW);
    expect(r1.step).toEqual({ date: '2026-11-08', text: 'спросить ответ по КП' });
    expect(r1.incomeOffer).toBe(false);
    const r2 = await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect(r2.deal.closedAt).not.toBeNull();
    expect(r2.deal.nextStepAt).toBeNull();
    expect(r2.incomeOffer).toBe(true);
    expect(await prisma.dealEvent.count({ where: { dealId: deal.id, kind: 'stage' } })).toBe(2);
  });

  it('ревью I3: выиграна без суммы → назвали сумму → предложение дохода', async () => {
    const userId = await user('wonamt');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' }, NOW);
    const r1 = await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect(r1.incomeOffer).toBe(false);
    const r2 = await updateDeal(userId, deal.id, { amount: 2_000_000 }, NOW);
    expect(r2.incomeOffer).toBe(true);
    await recordDealIncome(userId, deal.id, NOW);
    // доход уже записан — смена суммы больше не предлагает его
    const r3 = await updateDeal(userId, deal.id, { amount: 2_100_000 }, NOW);
    expect(r3.incomeOffer).toBe(false);
  });

  it('свой срок побеждает дефолт', async () => {
    const userId = await user('own');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x' }, NOW);
    const r = await updateDeal(userId, deal.id, { stage: 'talks', nextStepDate: '2026-11-11', nextStepText: 'перезвонить' }, NOW);
    expect(r.step).toEqual({ date: '2026-11-11', text: 'перезвонить' });
  });

  it('доход: один раз, повтор — no-op; без суммы — отказ', async () => {
    const userId = await user('income');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    const a = await recordDealIncome(userId, deal.id, NOW);
    const b = await recordDealIncome(userId, deal.id, NOW);
    expect(a).toEqual({ ok: true, already: false, amount: 2_000_000 });
    expect(b).toEqual({ ok: true, already: true, amount: 2_000_000 });
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    const { deal: d2 } = await createDeal(userId, { personName: 'Дана', title: 'y' }, NOW);
    expect(await recordDealIncome(userId, d2.id, NOW)).toEqual({ ok: false, reason: 'no_amount' });
  });

  it('чужая сделка не видна и не меняется', async () => {
    const a = await user('iso-a');
    const b = await user('iso-b');
    const { deal } = await createDeal(a, { personName: 'Ахмет', title: 'x', amount: 10 }, NOW);
    await expect(updateDeal(b, deal.id, { stage: 'won' }, NOW)).rejects.toThrow('not_found');
    expect(await recordDealIncome(b, deal.id, NOW)).toEqual({ ok: false, reason: 'not_found' });
    expect(await listDeals(b, 'open')).toHaveLength(0);
  });

  it('план месяца: закрыто/в работе/темп', async () => {
    const userId = await user('plan');
    await setSalesPlan(userId, 10_000_000, NOW);
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x', amount: 1_000_000 }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    await createDeal(userId, { personName: 'Серик', title: 'y', amount: 9_500_000 }, NOW);
    await createDeal(userId, { personName: 'Дана', title: 'z' }, NOW);
    const s = await salesPlanStatus(userId, new Date('2026-11-20T09:00:00Z'));
    expect(s).toMatchObject({ plan: 10_000_000, won: 1_000_000, open: 9_500_000, noAmount: 1 });
    expect(s?.pace.behind).toBe(true);
    expect(s?.covering).toEqual(['Серик']);
  });

  it('нит: план на другой месяц (YYYY-MM)', async () => {
    const userId = await user('planm');
    await setSalesPlan(userId, 5_000_000, NOW, '2026-12');
    expect(await salesPlanStatus(userId, NOW)).toBeNull();
    const dec = await salesPlanStatus(userId, NOW, '2026-12');
    expect(dec).toMatchObject({ plan: 5_000_000, won: 0 });
    expect(dec?.pace.behind).toBe(false);
    // выигранная в ноябре не считается в декабрь
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'x', amount: 1_000_000 }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect((await salesPlanStatus(userId, NOW, '2026-12'))?.won).toBe(0);
  });
});

