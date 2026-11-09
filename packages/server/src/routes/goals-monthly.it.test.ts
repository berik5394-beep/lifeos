import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { goalRoutes } from './goals.js';
import { runRegistryTool } from '../tools/index.js';
import { civilDayRefs, addCivilDays } from '../lib/tz.js';

/** Аудит 2026-11-09: цели на месяц видны в приложении; годовая цель — живой прогресс. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([goalRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user() {
  const u = await prisma.user.create({ data: { email: `gm-${Date.now()}-${Math.random()}@a.test`, name: 'G', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

describe('/goals/monthly', () => {
  it('цель, поставленная роботом, видна; добавить / отметить / убрать — с экрана', async () => {
    const { userId, headers } = await user();
    await runRegistryTool('create_monthly_goal', { goalText: 'Закрыть 3 сделки' }, { userId });
    const list = await app.inject({ method: 'GET', url: '/goals/monthly', headers });
    expect((list.json() as Array<{ goalText: string }>).map((g) => g.goalText)).toEqual(['Закрыть 3 сделки']);

    const c = await app.inject({ method: 'POST', url: '/goals/monthly', headers, payload: { goalText: 'Запустить рекламу' } });
    expect(c.statusCode).toBe(201);
    const id = c.json().id as string;
    const done = await app.inject({ method: 'PUT', url: `/goals/monthly/${id}`, headers, payload: { completed: true } });
    expect(done.json().completed).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/goals/monthly/${id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/goals/monthly', headers })).json()).toHaveLength(1);
    // другой месяц — пусто; мусор — 400
    expect((await app.inject({ method: 'GET', url: '/goals/monthly?month=2020-01', headers })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/goals/monthly?month=ноябрь', headers })).statusCode).toBe(400);
  });

  it('чужую цель месяца не трогаем', async () => {
    const a = await user();
    const b = await user();
    const c = await app.inject({ method: 'POST', url: '/goals/monthly', headers: a.headers, payload: { goalText: 'моя' } });
    const r = await app.inject({ method: 'PUT', url: `/goals/monthly/${c.json().id}`, headers: b.headers, payload: { completed: true } });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /goals/yearly — живой прогресс', () => {
  it('денежная цель: накоплено с даты цели; привычки: дни из 30', async () => {
    const { userId, headers } = await user();
    const year = new Date().getUTCFullYear();
    const today = civilDayRefs('UTC').today;
    const goal = await prisma.yearlyGoal.create({ data: { userId, year, area: 'finance', goalText: 'Накопить 1 000 000', target: 1_000_000 } });
    await prisma.income.create({ data: { userId, date: new Date(`${today}T00:00:00Z`), source: 'зп', amount: 500_000 } });
    await prisma.expense.create({ data: { userId, date: new Date(`${today}T00:00:00Z`), category: 'food', description: 'еда', amount: 100_000 } });
    const habit = await prisma.habit.create({ data: { userId, name: 'Не тратить', category: 'personal', frequency: 'daily', goalId: goal.id, createdAt: new Date(`${addCivilDays(today, -9)}T08:00:00Z`) } });
    for (const d of [0, 1, 3]) await prisma.habitLog.create({ data: { userId, habitId: habit.id, date: new Date(`${addCivilDays(today, -d)}T00:00:00Z`), completed: true } });

    const r = await app.inject({ method: 'GET', url: `/goals/yearly?year=${year}`, headers });
    const g = (r.json() as Array<Record<string, unknown>>)[0];
    expect(g).toMatchObject({ saved: 400_000, liveProgress: 40, progress: 0, habitDays: { done: 3, of: 10 } });
    expect((g.habits as Array<Record<string, unknown>>)[0]).not.toHaveProperty('createdAt');
  });
});
