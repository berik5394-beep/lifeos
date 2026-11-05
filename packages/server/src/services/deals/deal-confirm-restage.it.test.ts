import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../../test/integration/build-test-app.js';
import { chatRoutes } from '../../routes/chat.js';
import { setPendingAction } from '../pending-actions.js';
import { createDeal, updateDeal, DEAL_INCOME_ACTION } from './service.js';

/**
 * Ревью I-c: «Подтвердить» на доход по сделке → «Похоже, уже записан… Записать
 * ещё раз?» ставит НОВЫЙ pending. Ответ должен отдать его — иначе в приложении
 * вопрос без кнопок «Подтвердить / Отмена».
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([chatRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function dupSetup(tag: string) {
  const u = await prisma.user.create({ data: { email: `dcr-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } });
  await prisma.income.create({ data: { userId: u.id, date: new Date(), source: 'от Серика', amount: 500_000 } });
  const { deal } = await createDeal(u.id, { personName: 'Серик', title: 'склад', amount: 500_000, stage: 'contract' });
  await updateDeal(u.id, deal.id, { stage: 'won' });
  await setPendingAction(u.id, DEAL_INCOME_ACTION, { dealId: deal.id }, 'Записать доход?');
  return { userId: u.id, dealId: deal.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('повторный вопрос после подтверждения — с кнопками', () => {
  it('POST /voice/confirm-action → done:false + pendingAction + confirmationText', async () => {
    const { dealId, headers } = await dupSetup('rest');
    const res = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toMatch(/Записать ещё раз\?$/);
    expect(body.done).toBe(false);
    expect(body.pendingAction).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId, force: true } });
    expect(body.confirmationText).toBe(body.message);
    // кнопка «Подтвердить» на новом вопросе пишет повтор
    const again = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true, action: DEAL_INCOME_ACTION } });
    expect(again.json().done).toBe(true);
    expect(again.json().pendingAction ?? null).toBeNull();
  });

  it('POST /voice/chat «да» → pendingAction в ответе', async () => {
    const { userId, dealId, headers } = await dupSetup('chat');
    const res = await app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text: 'да' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().pendingAction).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId, force: true } });
    expect(await prisma.income.count({ where: { userId } })).toBe(1);
  });

  it('обычное подтверждение без нового вопроса → done:true, без pendingAction', async () => {
    const u = await prisma.user.create({ data: { email: `dcr-plain-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } });
    const { deal } = await createDeal(u.id, { personName: 'Дана', title: 'сервис', amount: 100_000, stage: 'contract' });
    await updateDeal(u.id, deal.id, { stage: 'won' });
    await setPendingAction(u.id, DEAL_INCOME_ACTION, { dealId: deal.id }, 'Записать доход?');
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const res = await app.inject({ method: 'POST', url: '/voice/confirm-action', headers, payload: { confirm: true } });
    expect(res.json()).toMatchObject({ done: true });
    expect(res.json().pendingAction ?? null).toBeNull();
  });
});

describe('ревью-3 N6: служебные __-ключи не уходят клиенту', () => {
  const setup = async (tag: string) => {
    const u = await prisma.user.create({ data: { email: `dcr-n6-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x', timezone: 'UTC' } });
    return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
  };
  const chat = (headers: Record<string, string>, text: string) =>
    app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text } });
  const pending = async (headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/voice/pending-action', headers })).json().pending;

  it('аванс по сделке: ни ответ чата, ни GET /voice/pending-action не несут __advanceDealId', async () => {
    const { userId, headers } = await setup('adv');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, stage: 'contract' });
    const r = await chat(headers, 'получил 500000 предоплату от Ахмета');
    expect(r.json().pendingAction).toEqual({ action: 'add_income', input: { amount: 500_000, source: 'предоплату от Ахмета' } });
    expect(await pending(headers)).toEqual({ action: 'add_income', input: { amount: 500_000, source: 'предоплату от Ахмета' } });
  });

  it('предложение закрыть сделку: GET /voice/pending-action без __source', async () => {
    const { userId, headers } = await setup('won');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', stage: 'contract' });
    await chat(headers, 'получил 2 млн от Ахмета');
    expect(await pending(headers)).toEqual({ action: DEAL_INCOME_ACTION, input: { dealId: deal.id, markWon: true, amount: 2_000_000 } });
  });

  it('слот «получил аванс 2 млн»: клиенту — только __awaitingSource (протокол мобилки), без __partial', async () => {
    const { headers } = await setup('slot');
    const r = await chat(headers, 'получил аванс 2 млн');
    expect(r.json().pendingAction).toEqual({ action: 'add_income', input: { amount: 2_000_000, __awaitingSource: true } });
    expect(await pending(headers)).toEqual({ action: 'add_income', input: { amount: 2_000_000, __awaitingSource: true } });
  });
});
