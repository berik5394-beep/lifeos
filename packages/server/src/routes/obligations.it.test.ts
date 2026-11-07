import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { obligationRoutes } from './obligations.js';
import { createObligation } from '../services/obligations/index.js';

/** Долги «Финансов» живут на сервере — те же, что голосом («Ахмет должен мне 500 000»). */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([obligationRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `obl-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'O', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('REST /obligations', () => {
  it('создать → в списке; голосовой денежный долг тоже виден; «вернули» → пропал из открытых', async () => {
    const { userId, headers } = await user('crud');
    const c = await app.inject({ method: 'POST', url: '/obligations', headers, payload: { personName: 'Банк', direction: 'i_owe', amount: 300000, dueDate: '2026-12-31' } });
    expect(c.statusCode).toBe(201);
    const id = c.json().obligation.id as string;
    await createObligation({ userId, personName: 'Ахмет', direction: 'owed_to_me', kind: 'money', description: 'должен мне', amount: 500000, source: 'ai_suggested' });
    await createObligation({ userId, personName: 'Мама', direction: 'i_owe', kind: 'action', description: 'позвонить', source: 'ai_suggested' });

    const list = (await app.inject({ method: 'GET', url: '/obligations', headers })).json().obligations as { personName: string; amount: number }[];
    expect(list.map((o) => [o.personName, o.amount]).sort()).toEqual([['Ахмет', 500000], ['Банк', 300000]]);

    expect((await app.inject({ method: 'POST', url: `/obligations/${id}/settle`, headers })).statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/obligations', headers })).json().obligations as { personName: string }[];
    expect(after.map((o) => o.personName)).toEqual(['Ахмет']);
  });

  it('чужой долг → 404; кривая сумма → 400', async () => {
    const a = await user('a');
    const b = await user('b');
    const id = (await app.inject({ method: 'POST', url: '/obligations', headers: a.headers, payload: { personName: 'X', direction: 'i_owe', amount: 1 } })).json().obligation.id;
    expect((await app.inject({ method: 'DELETE', url: `/obligations/${id}`, headers: b.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/obligations', headers: a.headers, payload: { personName: 'X', direction: 'i_owe', amount: -5 } })).statusCode).toBe(400);
  });
});
