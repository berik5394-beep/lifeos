import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { buildTestApp } from './integration/build-test-app.js';
import { authRoutes } from '../src/routes/auth.js';
import { taskRoutes } from '../src/routes/tasks.js';
import { habitRoutes } from '../src/routes/habits.js';
import { financeRoutes } from '../src/routes/finance.js';
import { seedDemo } from '../scripts/seed-demo.js';

/** Демо-аккаунт для ревью App Store: входит, видит заполненные экраны, согласие уже дано. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([authRoutes, taskRoutes, habitRoutes, financeRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('seed-demo', () => {
  it('создаёт заполненный аккаунт, повторный запуск ничего не трогает, вход работает', async () => {
    const email = `demo-${Date.now()}@a.test`;
    const password = randomBytes(9).toString('base64url');
    const r = await seedDemo(prisma, { email, password });
    expect(r.created).toBe(true);
    expect((await seedDemo(prisma, { email, password })).created).toBe(false);

    const id = r.userId;
    const [tasks, habits, logs, exp, inc, goals, events, deals, mem, journal, steps, coins] = await Promise.all([
      prisma.task.count({ where: { userId: id } }),
      prisma.habit.count({ where: { userId: id } }),
      prisma.habitLog.count({ where: { userId: id } }),
      prisma.expense.count({ where: { userId: id } }),
      prisma.income.count({ where: { userId: id } }),
      prisma.yearlyGoal.count({ where: { userId: id } }),
      prisma.calendarEvent.count({ where: { userId: id } }),
      prisma.deal.count({ where: { userId: id } }),
      prisma.memory.count({ where: { userId: id } }),
      prisma.journalEntry.count({ where: { userId: id } }),
      prisma.stepLog.count({ where: { userId: id } }),
      prisma.coinTransaction.aggregate({ where: { userId: id }, _sum: { amount: true } }),
    ]);
    expect(tasks).toBeGreaterThanOrEqual(15);
    expect(habits).toBe(5);
    expect(logs).toBeGreaterThan(50);
    expect(exp).toBe(24);
    expect(inc).toBe(3);
    expect(goals).toBe(4);
    expect(events).toBe(5);
    expect(deals).toBe(3);
    expect(mem).toBe(5);
    expect(journal).toBe(10);
    expect(steps).toBe(14);
    expect(coins._sum.amount).toBe(1500);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().accessToken}` };
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers })).json();
    expect(me.user.consentRequired).toBe(false);
    const habitsRes = await app.inject({ method: 'GET', url: '/habits', headers });
    expect(habitsRes.statusCode).toBe(200);
  });
});
