import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { stepsRoutes } from './steps.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([stepsRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /steps — шаги из «Здоровья»', () => {
  it('запись за день и обновление того же дня', async () => {
    const u = await prisma.user.create({ data: { email: `st-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    expect((await app.inject({ method: 'POST', url: '/steps', headers, payload: { date: '2026-11-08', steps: 4200 } })).json()).toMatchObject({ ok: true, steps: 4200 });
    await app.inject({ method: 'POST', url: '/steps', headers, payload: { date: '2026-11-08', steps: 9100, distanceKm: 6.4 } });
    const rows = await prisma.stepLog.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ steps: 9100, distanceKm: 6.4 });
  });
  it('мусор не принимается; без входа — 401', async () => {
    const u = await prisma.user.create({ data: { email: `st2-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    expect((await app.inject({ method: 'POST', url: '/steps', headers, payload: { date: 'вчера', steps: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/steps', payload: { date: '2026-11-08', steps: 1 } })).statusCode).toBe(401);
  });
});
