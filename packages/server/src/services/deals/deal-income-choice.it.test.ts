import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../../test/integration/build-test-app.js';
import { chatRoutes } from '../../routes/chat.js';
import { handleMessage } from '../jarvis-orchestrator.js';
import { peekPendingAction } from '../pending-actions.js';
import { createDeal, updateDeal, DEAL_INCOME_ACTION, DEAL_INCOME_CHOICE } from './service.js';

/**
 * Ревью-3: переспрос по доходу от клиента — «да»/«нет» на один вопрос о сделке (I3),
 * выход «просто доход» из предложения закрыть сделку (I4), подтверждение после правки
 * в панели (N5), устаревшая кнопка «Подтвердить» на переспросе (N12).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([chatRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dch-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}
const incomes = (userId: string) => prisma.income.findMany({ where: { userId }, select: { amount: true } });

describe('I3: один вопрос о сделке — «да» / «нет»', () => {
  it('сумма другая, «да» (полная оплата) → предложение закрыть на пришедшую сумму; «да» → выиграна, доход ровно пришедший', async () => {
    const userId = await user('diff-yes');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 3_000_000, stage: 'proposal' });
    const ask = await handleMessage(userId, 'получил 1 млн от Ахмета');
    expect(ask.reply).toMatch(/Это полная оплата по сделке\?/);
    expect((await peekPendingAction(userId))?.input).toMatchObject({ dealId: deal.id, amount: 1_000_000 });
    const offer = await handleMessage(userId, 'да');
    expect(offer.pendingAction).toEqual({
      action: DEAL_INCOME_ACTION,
      input: { dealId: deal.id, markWon: true, amount: 1_000_000, fullPayment: true },
    });
    expect(offer.reply).toMatch(/1 000 000 ₸/);
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    const done = await handleMessage(userId, 'да');
    expect(done.reply).toMatch(/Записал доход 1 000 000 ₸/);
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: d.stage, amount: d.amount }).toEqual({ stage: 'won', amount: 1_000_000 });
    expect(await incomes(userId)).toEqual([{ amount: 1_000_000 }]);
  });

  it('ранняя стадия без суммы, «да» → выиграна с этой суммой + доход', async () => {
    const userId = await user('early-yes');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    await handleMessage(userId, 'получил 2 млн от Ахмета');
    const offer = await handleMessage(userId, 'да');
    expect(offer.pendingAction).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId: deal.id, markWon: true, amount: 2_000_000, fullPayment: true } });
    await handleMessage(userId, 'да');
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: d.stage, amount: d.amount }).toEqual({ stage: 'won', amount: 2_000_000 });
    expect(await incomes(userId)).toEqual([{ amount: 2_000_000 }]);
  });

  it('«нет» (не полная) → обычный доход + заметка «аванс» после «да», сделка не закрыта', async () => {
    const userId = await user('diff-no');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 3_000_000, stage: 'proposal' });
    await handleMessage(userId, 'получил 1 млн от Ахмета');
    const r = await handleMessage(userId, 'нет');
    expect(r.pendingAction?.action).toBe('add_income');
    expect(r.pendingAction?.input).toMatchObject({ amount: 1_000_000, source: 'Ахмета' });
    expect(r.reply).toMatch(/не закрываю — отмечу в ней аванс/);
    await handleMessage(userId, 'да');
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: d.stage, amount: d.amount }).toEqual({ stage: 'proposal', amount: 3_000_000 });
    expect(await incomes(userId)).toEqual([{ amount: 1_000_000 }]);
    expect((await prisma.dealEvent.findFirst({ where: { dealId: deal.id, kind: 'note' } }))?.text).toBe('аванс 1 000 000 ₸');
  });

  it('несколько сделок: подсказка на «да» — из настоящих сделок, не «Ахмет оплатил оборудование»', async () => {
    const userId = await user('multi');
    await createDeal(userId, { personName: 'Серик', title: 'склад' });
    await createDeal(userId, { personName: 'Серик', title: 'сервис' });
    await handleMessage(userId, 'получил 2 млн от Серика');
    const yes = await handleMessage(userId, 'да');
    expect(yes.reply).toMatch(/«Серик оплатил (склад|сервис)»/);
    expect(yes.reply).not.toMatch(/Ахмет/);
    expect(yes.pendingAction ?? null).toBeNull();
    expect((await peekPendingAction(userId))?.action).toBe(DEAL_INCOME_CHOICE);
  });
});

describe('I4: выход «просто доход» из предложения закрыть сделку', () => {
  it('предложение называет выход; «просто доход» → обычный доход той же суммы, сделка не закрыта, заметка «аванс» после «да»', async () => {
    const userId = await user('just');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    const offer = await handleMessage(userId, 'получил 2 млн от Ахмета');
    expect(offer.reply).toMatch(/Или скажи «просто доход» — запишу обычным доходом, сделку не трогаю\./);
    const r = await handleMessage(userId, 'просто доход');
    expect(r.pendingAction).toEqual({ action: 'add_income', input: { amount: 2_000_000, source: 'Ахмета' } });
    await handleMessage(userId, 'да');
    const d = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect({ stage: d.stage, amount: d.amount, wonIncomeId: d.wonIncomeId }).toEqual({ stage: 'contract', amount: null, wonIncomeId: null });
    expect(await incomes(userId)).toEqual([{ amount: 2_000_000 }]);
    expect((await prisma.dealEvent.findFirst({ where: { dealId: deal.id, kind: 'note' } }))?.text).toBe('аванс 2 000 000 ₸');
  });
});

describe('N5: подтверждение после правки сделки в панели', () => {
  it('сделку отметили проигранной → доход не пишем, «просто доход» работает', async () => {
    const userId = await user('lost');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    await handleMessage(userId, 'получил 2 млн от Ахмета');
    await updateDeal(userId, deal.id, { stage: 'lost' });
    const r = await handleMessage(userId, 'да');
    expect(r.reply).toBe('Сделку отметили проигранной — доход не записал. Скажи «просто доход», если деньги пришли.');
    expect(r.pendingAction ?? null).toBeNull();
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe('lost');
    expect(await prisma.income.count({ where: { userId } })).toBe(0);
    const j = await handleMessage(userId, 'просто доход');
    expect(j.pendingAction).toEqual({ action: 'add_income', input: { amount: 2_000_000, source: 'Ахмета' } });
    await handleMessage(userId, 'да');
    expect(await incomes(userId)).toEqual([{ amount: 2_000_000 }]);
  });

  it('в панели уже «выиграна» без суммы → сумма из предложения ставится, доход пишется', async () => {
    const userId = await user('won-noamt');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    await handleMessage(userId, 'получил 2 млн от Ахмета');
    await updateDeal(userId, deal.id, { stage: 'won' });
    const r = await handleMessage(userId, 'да');
    expect(r.reply).toMatch(/Записал доход 2 000 000 ₸/);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).amount).toBe(2_000_000);
    expect(await incomes(userId)).toEqual([{ amount: 2_000_000 }]);
  });

  it('в панели поменяли сумму → пишем сумму сделки и честно её называем', async () => {
    const userId = await user('amt-changed');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    await handleMessage(userId, 'получил 2 млн от Ахмета');
    await updateDeal(userId, deal.id, { amount: 2_500_000 });
    const r = await handleMessage(userId, 'да');
    expect(r.reply).toMatch(/Записал доход 2 500 000 ₸/);
    expect(r.reply).toMatch(/не 2 000 000 ₸/);
    expect(await incomes(userId)).toEqual([{ amount: 2_500_000 }]);
  });
});

describe('N12: устаревшая кнопка «Подтвердить» на переспросе', () => {
  it('POST /voice/confirm-action без action на deal_income_choice → подсказка, переспрос остаётся', async () => {
    const userId = await user('stale-btn');
    await createDeal(userId, { personName: 'Серик', title: 'склад' });
    await createDeal(userId, { personName: 'Серик', title: 'сервис' });
    await handleMessage(userId, 'получил 2 млн от Серика');
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` };
    const res = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ done: false });
    expect(res.json().message).toMatch(/просто доход/);
    expect(res.json().pendingAction ?? null).toBeNull();
    expect((await peekPendingAction(userId))?.action).toBe(DEAL_INCOME_CHOICE);
    const j = await handleMessage(userId, 'просто доход');
    expect(j.pendingAction).toEqual({ action: 'add_income', input: { amount: 2_000_000, source: 'Серика' } });
  });
});
