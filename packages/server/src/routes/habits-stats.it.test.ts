import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { habitRoutes, longestRun } from './habits.js';

/**
 * GET /habits/stats/:month — форма, которую читает экран привычек
 * (habitId/completed/total/streak). Раньше сервер отдавал completedDays/
 * totalDays, и «Лучшая серия» / «Выполнено» показывали NaN (аудит 2026-11-08).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([habitRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('статистика привычек за месяц', () => {
  it('прошлый месяц: completed, total = все дни, streak = лучшая серия', async () => {
    const u = await prisma.user.create({ data: { email: `hstat-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'UTC' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const h = await prisma.habit.create({ data: { userId: u.id, name: 'Бег', category: 'health', frequency: 'daily' } });
    for (const d of ['2026-01-03', '2026-01-04', '2026-01-05', '2026-01-10']) {
      await prisma.habitLog.create({ data: { habitId: h.id, userId: u.id, date: new Date(`${d}T00:00:00Z`), completed: true } });
    }
    await prisma.habitLog.create({ data: { habitId: h.id, userId: u.id, date: new Date('2026-01-11T00:00:00Z'), completed: false } });

    const r = await app.inject({ method: 'GET', url: '/habits/stats/2026-01', headers });
    expect(r.statusCode).toBe(200);
    const [s] = r.json() as Array<Record<string, unknown>>;
    expect(s).toMatchObject({ habitId: h.id, habitName: 'Бег', completed: 4, total: 31, streak: 3 });
    for (const k of ['completed', 'total', 'streak']) expect(Number.isFinite(s[k] as number)).toBe(true);
  });

  it('будущий месяц → total 0 (не делим на непрошедшие дни)', async () => {
    const u = await prisma.user.create({ data: { email: `hstat2-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'UTC' } });
    await prisma.habit.create({ data: { userId: u.id, name: 'Бег', category: 'health', frequency: 'daily' } });
    const r = await app.inject({ method: 'GET', url: '/habits/stats/2099-01', headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } });
    expect(r.json()[0]).toMatchObject({ completed: 0, total: 0, streak: 0 });
  });

  it('longestRun', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(longestRun([])).toBe(0);
    expect(longestRun([d('2026-01-01'), d('2026-01-02'), d('2026-01-04')])).toBe(2);
    expect(longestRun([d('2026-01-31'), d('2026-02-01')])).toBe(2);
  });
});
