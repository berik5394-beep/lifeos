import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { habitRoutes } from '../routes/habits.js';
import { completeHabitTool } from '../tools/complete-habit.js';
import { localDateStr } from '../lib/tz.js';

/**
 * Робот = экран (Berik 2026-11-09): отметка привычки ТАПОМ говорит то же, что
 * отметка голосом — к какой цели это шаг. Раньше экран давал только улыбку.
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
async function setup(tag: string, withGoal: boolean) {
  const u = await prisma.user.create({
    data: { email: `hgl-${tag}-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  const goal = withGoal
    ? await prisma.yearlyGoal.create({
        data: { userId: u.id, year: new Date().getUTCFullYear(), area: 'health', goalText: 'Пробежать марафон' },
      })
    : null;
  const habit = await prisma.habit.create({
    data: { userId: u.id, name: 'Бег', category: 'health', frequency: 'daily', goalId: goal?.id ?? null },
  });
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
  return { userId: u.id, habitId: habit.id, headers, today: localDateStr('Asia/Almaty') };
}

describe('привычка → цель: экран и робот говорят одно', () => {
  it('отметка с экрана привязанной привычки → облачко «шаг к цели», серия', async () => {
    const { habitId, headers, today } = await setup('rest', true);
    const res = await app.inject({ method: 'POST', url: `/habits/${habitId}/log`, headers, payload: { date: today, completed: true } });
    expect(res.statusCode).toBeLessThan(300);
    const body = res.json() as { completed: boolean; reaction?: string };
    expect(body.completed).toBe(true);
    expect(body.reaction).toContain('Пробежать марафон');
    expect(body.reaction).toMatch(/Серия — 1 день/);
  });

  it('снял отметку → без облачка', async () => {
    const { habitId, headers, today } = await setup('undo', true);
    const res = await app.inject({ method: 'POST', url: `/habits/${habitId}/log`, headers, payload: { date: today, completed: false } });
    expect((res.json() as { reaction?: string }).reaction).toBeUndefined();
  });

  it('привычка без цели → без облачка (только улыбка)', async () => {
    const { habitId, headers, today } = await setup('nogoal', false);
    const res = await app.inject({ method: 'POST', url: `/habits/${habitId}/log`, headers, payload: { date: today, completed: true } });
    expect((res.json() as { reaction?: string }).reaction).toBeUndefined();
  });

  it('голосом (complete_habit) — та же цель', async () => {
    const { userId } = await setup('tool', true);
    const out = (await completeHabitTool.handler({ name: 'бег' } as never, { userId } as never)) as { message: string };
    expect(out.message).toContain('к цели «Пробежать марафон»');
  });
});
