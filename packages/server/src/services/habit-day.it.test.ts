import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { habitRoutes } from '../routes/habits.js';
import { runRegistryTool } from '../tools/index.js';
import { gatherOpenLoops } from './open-loops.js';
import { calculateStreak } from './streak-service.js';
import { civilDayRefs } from '../lib/tz.js';

/**
 * habit-day (2026-11-05): ОДНА дата отметки привычки = календарная дата юзера.
 * Раньше голос/чат приложения (инструменты complete_habit*) писали
 * localDayStartUTC → для UTC+ зон в @db.Date это ВЧЕРА, а приложение (REST)
 * писало календарную дату → отметки расходились, а приложение не умело
 * загружать отметки с сервера вовсе.
 *
 * Pacific/Kiritimati = UTC+14: старая конвенция ВСЕГДА давала «вчера» →
 * тест ловит баг в любой момент запуска.
 */
const TZ = 'Pacific/Kiritimati';
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([habitRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function setup(tag: string) {
  const u = await prisma.user.create({
    data: { email: `hd-${tag}-${Date.now()}@a.test`, name: 'H', passwordHash: 'x', timezone: TZ },
  });
  const habit = await prisma.habit.create({
    data: { userId: u.id, name: 'Бег', category: 'health', frequency: 'daily' },
  });
  return { userId: u.id, habitId: habit.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}

async function logsFor(headers: Record<string, string>, from: string, to: string) {
  const res = await app.inject({ method: 'GET', url: `/habits/logs?from=${from}&to=${to}`, headers });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ habitId: string; date: string; completed: boolean }>;
}

describe('habit-day: одна дата отметки (приложение ↔ мозг)', () => {
  it('голос/чат (complete_habit) → отметка на ЛОКАЛЬНОЕ сегодня, видна приложению через GET /habits/logs', async () => {
    const { userId, habitId, headers } = await setup('tool');
    const today = civilDayRefs(TZ).today;
    await runRegistryTool('complete_habit', { name: 'бег' }, { userId });
    const logs = await logsFor(headers, today, today);
    expect(logs).toEqual([expect.objectContaining({ habitId, date: today, completed: true })]);
  });

  it('complete_multiple_habits → тоже локальное сегодня', async () => {
    const { userId, habitId, headers } = await setup('multi');
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    const today = civilDayRefs(TZ).today;
    await runRegistryTool('complete_multiple_habits', { habitNames: ['бег', 'чтение'] }, { userId });
    const logs = await logsFor(headers, today, today);
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.habitId === habitId)?.date).toBe(today);
  });

  it('ручная отметка в приложении (REST) → мозг видит её как «сегодня»: open-loops не считает открытой, серия ≥ 1', async () => {
    const { userId, habitId, headers } = await setup('rest');
    const today = civilDayRefs(TZ).today;
    const res = await app.inject({
      method: 'POST',
      url: `/habits/${habitId}/log`,
      headers,
      payload: { date: today, completed: true },
    });
    expect(res.statusCode).toBeLessThan(300);
    const loops = await gatherOpenLoops(userId);
    expect(loops.uncheckedHabitNames).not.toContain('Бег');
    expect(await calculateStreak(userId)).toBeGreaterThanOrEqual(1);
  });

  it('GET /habits/logs: диапазон, чужие отметки не видны, лимит и валидация', async () => {
    const a = await setup('a');
    const b = await setup('b');
    await prisma.habitLog.create({ data: { habitId: a.habitId, userId: a.userId, date: new Date('2026-10-01T00:00:00Z'), completed: true } });
    await prisma.habitLog.create({ data: { habitId: b.habitId, userId: b.userId, date: new Date('2026-10-01T00:00:00Z'), completed: true } });
    const logs = await logsFor(a.headers, '2026-10-01', '2026-10-31');
    expect(logs).toEqual([expect.objectContaining({ habitId: a.habitId, date: '2026-10-01' })]);
    const tooLong = await app.inject({ method: 'GET', url: '/habits/logs?from=2026-01-01&to=2026-12-31', headers: a.headers });
    expect(tooLong.statusCode).toBe(400);
    const bad = await app.inject({ method: 'GET', url: '/habits/logs?from=вчера&to=2026-10-31', headers: a.headers });
    expect(bad.statusCode).toBe(400);
  });
});
