import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { dealRoutes } from './deals.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([dealRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `drest-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('REST /deals', () => {
  it('создать → список → сменить стадию → доход один раз', async () => {
    const { headers } = await user('crud');
    const c = await app.inject({ method: 'POST', url: '/deals', headers, payload: { personName: 'Ахмет', title: 'оборудование', amount: 2000000 } });
    expect(c.statusCode).toBe(201);
    const id = c.json().deal.id as string;
    expect(c.json().step).toMatchObject({ text: 'связаться' });
    const list = await app.inject({ method: 'GET', url: '/deals?status=open', headers });
    expect(list.json().deals).toHaveLength(1);
    const u = await app.inject({ method: 'PUT', url: `/deals/${id}`, headers, payload: { stage: 'won' } });
    expect(u.json().incomeOffer).toBe(true);
    const i1 = await app.inject({ method: 'POST', url: `/deals/${id}/income`, headers });
    const i2 = await app.inject({ method: 'POST', url: `/deals/${id}/income`, headers });
    expect(i1.json()).toMatchObject({ ok: true, already: false });
    expect(i2.json()).toMatchObject({ ok: true, already: true });
    const one = await app.inject({ method: 'GET', url: `/deals/${id}`, headers });
    expect(one.json().deal.events.length).toBeGreaterThanOrEqual(2);
  });

  it('чужая сделка → 404', async () => {
    const a = await user('a');
    const b = await user('b');
    const c = await app.inject({ method: 'POST', url: '/deals', headers: a.headers, payload: { personName: 'Ахмет' } });
    const id = c.json().deal.id as string;
    expect((await app.inject({ method: 'GET', url: `/deals/${id}`, headers: b.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/deals/${id}`, headers: b.headers, payload: { stage: 'won' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/deals/${id}/income`, headers: b.headers })).statusCode).toBe(404);
  });

  it('план месяца', async () => {
    const { headers } = await user('plan');
    expect((await app.inject({ method: 'GET', url: '/sales-plan', headers })).json()).toEqual({ plan: null });
    await app.inject({ method: 'PUT', url: '/sales-plan', headers, payload: { amount: 10000000 } });
    expect((await app.inject({ method: 'GET', url: '/sales-plan', headers })).json().plan).toMatchObject({ plan: 10000000, won: 0 });
  });

  it('доход уже записан руками → 409 с вопросом; force=true → пишем', async () => {
    const { userId, headers } = await user('dup');
    await prisma.income.create({ data: { userId, date: new Date(), source: 'Ахмет', amount: 2000000 } });
    const c = await app.inject({ method: 'POST', url: '/deals', headers, payload: { personName: 'Ахмет', title: 'оборудование', amount: 2000000 } });
    const id = c.json().deal.id as string;
    await app.inject({ method: 'PUT', url: `/deals/${id}`, headers, payload: { stage: 'won' } });
    const i1 = await app.inject({ method: 'POST', url: `/deals/${id}/income`, headers });
    expect(i1.statusCode).toBe(409);
    expect(i1.json().message).toMatch(/^Похоже, этот доход уже записан/);
    const i2 = await app.inject({ method: 'POST', url: `/deals/${id}/income?force=true`, headers });
    expect(i2.json()).toMatchObject({ ok: true, already: false });
    expect(await prisma.income.count({ where: { userId } })).toBe(2);
  });

  it('нит: суммы ограничены, note при создании, план на месяц ?month=', async () => {
    const { userId, headers } = await user('nits');
    expect((await app.inject({ method: 'POST', url: '/deals', headers, payload: { personName: 'А', amount: 2_000_000_000 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/sales-plan', headers, payload: { amount: 2_000_000_000 } })).statusCode).toBe(400);
    const c = await app.inject({ method: 'POST', url: '/deals', headers, payload: { personName: 'Ахмет', note: 'с выставки' } });
    expect(c.statusCode).toBe(201);
    const ev = await prisma.dealEvent.findFirstOrThrow({ where: { dealId: c.json().deal.id, kind: 'created' } });
    expect(ev.text).toBe('с выставки');
    const id = c.json().deal.id as string;
    expect((await app.inject({ method: 'PUT', url: `/deals/${id}`, headers, payload: { amount: 2_000_000_000 } })).statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/sales-plan', headers, payload: { amount: 7000000, month: '2027-01' } });
    expect((await app.inject({ method: 'GET', url: '/sales-plan?month=2027-01', headers })).json().plan).toMatchObject({ plan: 7000000 });
    expect((await app.inject({ method: 'GET', url: '/sales-plan', headers })).json()).toEqual({ plan: null });
    expect((await app.inject({ method: 'GET', url: '/sales-plan?month=2027-13', headers })).statusCode).toBe(400);
    expect(await prisma.salesPlan.count({ where: { userId } })).toBe(1);
  });

  it('флаг off → 404', async () => {
    process.env.FEATURE_V2_DEALS = '';
    const { headers } = await user('off');
    expect((await app.inject({ method: 'GET', url: '/deals', headers })).statusCode).toBe(404);
  });
});

describe('аванс + «выиграна» — доход не задваивается (аудит 2026-11-09)', () => {
  it('сделка 2 млн, аванс 500к → предложение и запись — 1,5 млн', async () => {
    const { headers, userId } = await user('adv');
    const { noteDealAdvance } = await import('../services/deals/index.js');
    const c = await app.inject({ method: 'POST', url: '/deals', headers, payload: { personName: 'Ахмет', title: 'станок', amount: 2000000 } });
    const id = c.json().deal.id as string;
    await prisma.income.create({ data: { userId, date: new Date(), source: 'аванс Ахмет', amount: 500000 } });
    await noteDealAdvance(userId, id, 500000);
    const won = await app.inject({ method: 'PUT', url: `/deals/${id}`, headers, payload: { stage: 'won' } });
    expect(won.json()).toMatchObject({ incomeOffer: true, incomeDue: 1500000 });
    const inc = await app.inject({ method: 'POST', url: `/deals/${id}/income`, headers });
    expect(inc.json()).toMatchObject({ ok: true, already: false, amount: 1500000 });
    const total = await prisma.income.aggregate({ where: { userId }, _sum: { amount: true } });
    expect(total._sum.amount).toBe(2000000);
  });
});
