import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from './tasks.js';

/** «Активность за год» — по всей базе, а не по загруженной неделе. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([taskRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('GET /tasks/activity', () => {
  it('% по дню за весь год; отменённые и другой год не считаются; чужие не видны', async () => {
    const u = await prisma.user.create({ data: { email: `act-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } });
    const other = await prisma.user.create({ data: { email: `act2-${Date.now()}-${Math.random()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'UTC' } });
    const t = (userId: string, date: string, completed: boolean, cancelled = false) =>
      prisma.task.create({ data: { userId, title: 'x', category: 'work', priority: 'low', date: new Date(`${date}T00:00:00Z`), completed, cancelled } });
    await t(u.id, '2026-02-10', true);
    await t(u.id, '2026-02-10', false);
    await t(u.id, '2026-02-10', false, true); // отменённая — мимо
    await t(u.id, '2026-09-01', true);
    await t(u.id, '2025-12-31', true); // прошлый год — мимо
    await t(other.id, '2026-03-03', true);

    const res = await app.inject({ method: 'GET', url: '/tasks/activity?year=2026', headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ year: 2026, days: { '2026-02-10': 50, '2026-09-01': 100 } });
  });
});

describe('GET /tasks — отменённые («убери задачу») не видны ни в одной выборке', () => {
  it('date / week / month / всё', async () => {
    const u = await prisma.user.create({ data: { email: `cnl-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', timezone: 'UTC' } });
    const mk = (title: string, cancelled: boolean) =>
      prisma.task.create({ data: { userId: u.id, title, category: 'work', priority: 'low', date: new Date('2026-11-09T00:00:00Z'), cancelled } });
    await mk('живая', false);
    await mk('убранная', true);
    const h = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    for (const q of ['?date=2026-11-09', '?week=2026-11-09', '?month=2026-11', '']) {
      const res = await app.inject({ method: 'GET', url: `/tasks${q}`, headers: h });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Array<{ title: string }>).map((t) => t.title)).toEqual(['живая']);
    }
  });
});
