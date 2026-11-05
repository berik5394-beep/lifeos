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

const coins = (userId: string) => prisma.coinTransaction.count({ where: { userId, refKey: { startsWith: 'deal:' } } });

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dinr-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}

describe('доход от клиента с открытой сделкой', () => {
  it('X1: стадия «договор», без суммы → ДО «Подтвердить» ничего не пишем; «да» → won+сумма+доход+монеты один раз', async () => {
    const userId = await user('one');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.pendingAction).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId: deal.id, markWon: true, amount: 2_000_000 } });
    expect(r.reply).toMatch(/закрыть как выигранную и записать доход 2 000 000 ₸ от Ахмета\?/);
    // Маршрутизация НИЧЕГО не пишет: сделка как была, денег и монет нет.
    const mid = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: mid.stage, amount: mid.amount, nextStepAt: mid.nextStepAt }).toEqual({ stage: before.stage, amount: before.amount, nextStepAt: before.nextStepAt });
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    expect(await coins(userId)).toBe(0);
    const ok = await handleMessage(userId, 'да');
    expect(ok.reply).toMatch(/выиграна/);
    expect(ok.reply).toMatch(/Записал доход 2 000 000 ₸/);
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d.stage).toBe('won');
    expect(d.amount).toBe(2_000_000);
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    expect((await prisma.income.findFirstOrThrow({ where: { userId } })).amount).toBe(2_000_000);
    expect(await coins(userId)).toBe(1);
  });

  it('X1: «нет» → сделка нетронута, 0 дохода, 0 монет', async () => {
    const userId = await user('no');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    await handleMessage(userId, 'получил 2 млн от Ахмета');
    const r = await handleMessage(userId, 'нет');
    expect(r.reply).toBe('Окей, отменил — ничего не записал.');
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: d.stage, amount: d.amount, nextStepAt: d.nextStepAt, wonIncomeId: d.wonIncomeId }).toEqual({ stage: before.stage, amount: before.amount, nextStepAt: before.nextStepAt, wonIncomeId: null });
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    expect(await coins(userId)).toBe(0);
  });

  it('X1: сумма совпала со сделкой на ранней стадии → тоже предложение закрыть', async () => {
    const userId = await user('eq');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, stage: 'proposal' });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.pendingAction).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId: deal.id, markWon: true, amount: 2_000_000 } });
  });

  it('X1(b): ранняя стадия и сумма неизвестна → переспрос, ничего не ставим', async () => {
    const userId = await user('early');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.reply).toMatch(/ещё на стадии «Новая»/);
    expect(r.pendingAction ?? null).toBeNull();
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe('new');
  });

  it('X1(a): предоплата/аванс → обычный доход, сделку не закрываем; после «да» — заметка «аванс» в сделке', async () => {
    const userId = await user('adv');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, stage: 'contract' });
    const r = await handleMessage(userId, 'получил 500000 предоплату от Ахмета');
    expect(r.pendingAction?.action).toBe('add_income');
    expect(r.reply).toMatch(/не закрываю/);
    expect(await prisma.dealEvent.count({ where: { dealId: deal.id, kind: 'note' } })).toBe(0);
    await handleMessage(userId, 'да');
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(d.stage).toBe('contract');
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
    expect(await coins(userId)).toBe(0);
    const note = await prisma.dealEvent.findFirst({ where: { dealId: deal.id, kind: 'note' } });
    expect(note?.text).toBe('аванс 500 000 ₸');
  });

  it('X1(a): «получил аванс … от Ахмета» тоже не закрывает', async () => {
    const userId = await user('adv2');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 500_000, stage: 'contract' });
    const r = await handleMessage(userId, 'получил аванс 500000 от Ахмета');
    expect(r.pendingAction?.action).toBe('add_income');
    expect(await prisma.deal.count({ where: { userId, stage: 'won' } })).toBe(0);
  });

  it('X1(c)+нит: «от клиента Даны» / «от ТОО Альфа» — точное имя по словам', async () => {
    const userId = await user('fill');
    const dana = (await createDeal(userId, { personName: 'Дана', title: 'склад', stage: 'contract' })).deal;
    const r = await handleMessage(userId, 'получил 800 тысяч от клиента Даны');
    expect(r.pendingAction?.input).toMatchObject({ dealId: dana.id, markWon: true, amount: 800_000 });
    await handleMessage(userId, 'нет');
    const alfa = (await createDeal(userId, { personName: 'ТОО Альфа', title: 'сервис', stage: 'contract' })).deal;
    const r2 = await handleMessage(userId, 'получил 300000 от ТОО Альфа');
    expect(r2.pendingAction?.input).toMatchObject({ dealId: alfa.id, markWon: true });
  });

  it('X1(c): похожее, но другое имя («Ахмед» при сделке «Ахмет») → обычный доход', async () => {
    const userId = await user('near');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмеда');
    expect(r.pendingAction?.action).toBe('add_income');
  });

  it('нит: вернули в работу сделку с уже записанным доходом → без нового «Записать доход»', async () => {
    const userId = await user('reopen');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, stage: 'contract' });
    await updateDeal(userId, deal.id, { stage: 'won' });
    await recordDealIncome(userId, deal.id);
    await updateDeal(userId, deal.id, { stage: 'contract' });
    const r = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(r.reply).not.toMatch(/Записать доход/);
    expect(r.reply).toMatch(/уже записан/);
    await handleMessage(userId, 'да');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe('won');
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
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
