import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { handleMessage, runConfirmedAction } from '../jarvis-orchestrator.js';
import { peekPendingAction } from '../pending-actions.js';
import { createDeal, updateDeal, recordDealIncome, DEAL_INCOME_ACTION } from './service.js';

/**
 * Ревью B2: «получил 2 млн от Ахмета» при открытой сделке с Ахметом — доход
 * записывается ОДИН раз (через сделку), а не голым add_income + ещё раз при «выиграна».
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dinr-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}

describe('доход от клиента с открытой сделкой', () => {
  it('одна сделка без суммы → выиграна, сумма из сообщения, одно подтверждение → один Income', async () => {
    const userId = await user('one');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.pendingAction?.action).toBe(DEAL_INCOME_ACTION);
    expect(r.reply).toMatch(/Записать доход/);
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d.stage).toBe('won');
    expect(d.amount).toBe(2_000_000);
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    await handleMessage(userId, 'да');
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    expect((await prisma.income.findFirstOrThrow({ where: { userId } })).amount).toBe(2_000_000);
  });

  it('две открытые → спрашиваем какая, ничего не ставим', async () => {
    const userId = await user('two');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    await createDeal(userId, { personName: 'Ахмет', title: 'сервис' });
    const r = await handleMessage(userId, 'получил 2000000 от Ахмета');
    expect(r.reply).toMatch(/У Ахмета 2 открытые сделки/);
    expect(r.pendingAction ?? null).toBeNull();
    expect(await peekPendingAction(userId)).toBeNull();
    expect(await prisma.deal.count({ where: { userId, stage: 'won' } })).toBe(0);
  });

  it('сумма сделки другая → переспрос, сделку не трогаем', async () => {
    const userId = await user('diff');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 3_000_000 });
    const r = await handleMessage(userId, 'получил 1 млн от Ахмета');
    expect(r.reply).toMatch(/оборудование/);
    expect(await peekPendingAction(userId)).toBeNull();
    expect(await prisma.deal.count({ where: { userId, stage: 'won' } })).toBe(0);
  });

  it('нет сделки → прежний add_income', async () => {
    const userId = await user('none');
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.pendingAction?.action).toBe('add_income');
    expect(r.pendingAction?.input).toMatchObject({ amount: 2_000_000, source: 'Ахмета' });
  });

  it('флаг off → прежний add_income даже при сделке', async () => {
    const userId = await user('off');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    process.env.FEATURE_V2_DEALS = '';
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.pendingAction?.action).toBe('add_income');
  });
});

describe('страховка: доход уже записан руками', () => {
  it('такой же доход от клиента за 30 дней → не пишем молча; force → пишем', async () => {
    const userId = await user('dup');
    await prisma.income.create({ data: { userId, date: new Date(), source: 'Ахмета', amount: 2_000_000 } });
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 });
    await updateDeal(userId, deal.id, { stage: 'won' });
    const r = await recordDealIncome(userId, deal.id);
    expect(r).toMatchObject({ ok: false, reason: 'possible_duplicate' });
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    const f = await recordDealIncome(userId, deal.id, new Date(), { force: true });
    expect(f).toMatchObject({ ok: true, already: false });
    expect(await prisma.income.count({ where: { userId } })).toBe(2);
  });

  it('подтверждение: переспрашивает и ставит повтор с force', async () => {
    const userId = await user('dupc');
    await prisma.income.create({ data: { userId, date: new Date(), source: 'от Серика', amount: 500_000 } });
    const { deal } = await createDeal(userId, { personName: 'Серик', title: 'склад', amount: 500_000 });
    await updateDeal(userId, deal.id, { stage: 'won' });
    const m = await runConfirmedAction(userId, DEAL_INCOME_ACTION, { dealId: deal.id });
    expect(m).toMatch(/^Похоже, этот доход уже записан \(500 000 ₸ от Серика/);
    expect(m).toMatch(/Записать ещё раз\?$/);
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    const p = await peekPendingAction(userId);
    expect(p).toMatchObject({ action: DEAL_INCOME_ACTION, input: { dealId: deal.id, force: true } });
    await handleMessage(userId, 'да');
    expect(await prisma.income.count({ where: { userId } })).toBe(2);
  });
});
