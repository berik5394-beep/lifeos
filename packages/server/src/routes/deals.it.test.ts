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

  it('флаг off → 404', async () => {
    process.env.FEATURE_V2_DEALS = '';
    const { headers } = await user('off');
    expect((await app.inject({ method: 'GET', url: '/deals', headers })).statusCode).toBe(404);
  });
});
