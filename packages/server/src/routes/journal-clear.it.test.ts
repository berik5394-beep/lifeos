import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { journalRoutes } from './journal.js';

/** Аудит 2026-11-09: повторный тап «очистить» — null доходит до базы; не названное — не трогаем. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([journalRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('POST /journal', () => {
  it('null очищает поле, отсутствующее поле не меняется', async () => {
    const u = await prisma.user.create({ data: { email: `jr-${Date.now()}-${Math.random()}@a.test`, name: 'J', passwordHash: 'x', timezone: 'UTC' } });
    const h = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const post = (payload: object) => app.inject({ method: 'POST', url: '/journal', headers: h, payload: { date: '2026-11-09', ...payload } });
    await post({ mood: 7, sleepHours: 6 });
    await post({ mood: null });
    const e = await prisma.journalEntry.findFirst({ where: { userId: u.id } });
    expect(e).toMatchObject({ mood: null, sleepHours: 6 });
  });
});
