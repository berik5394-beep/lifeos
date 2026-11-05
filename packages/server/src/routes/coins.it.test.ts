import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { coinRoutes } from './coins.js';
import { taskRoutes } from './tasks.js';
import { habitRoutes } from './habits.js';
import { journalRoutes } from './journal.js';
import { awardCoins, coinBalance, onTaskCompleted } from '../services/coins.js';
import { completeHabitTool } from '../tools/complete-habit.js';
import { completeTaskTool } from '../tools/complete-task.js';

/**
 * Робот-эпик, Часть 6: монеты за дела. Начисляются из приложения (REST) и из
 * мозга (через ту же точку), один раз за дело, с дневным лимитом.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([coinRoutes, taskRoutes, habitRoutes, journalRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `coins-${tag}-${Date.now()}@a.test`, name: 'C', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const today = () => new Date(todayStr() + 'T00:00:00Z');
const settle = () => new Promise((r) => setTimeout(r, 150)); // начисления из REST — фоном

describe('монеты за дела', () => {
  it('GET /coins: стартовый подарок 200 — один раз', async () => {
    const { headers } = await user('start');
    expect((await app.inject({ method: 'GET', url: '/coins', headers })).json().balance).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/coins', headers })).json().balance).toBe(200);
  });

  it('задача выполнена в приложении → +10; снять и снова выполнить — не начисляется повторно', async () => {
    const { userId, headers } = await user('task');
    const t = await prisma.task.create({
      data: { userId, title: 'Отчёт', category: 'work', priority: 'medium', date: today() },
    });
    await prisma.task.create({ data: { userId, title: 'Ещё', category: 'work', priority: 'low', date: today() } });
    await app.inject({ method: 'PATCH', url: `/tasks/${t.id}/complete`, headers });
    await settle();
    expect(await coinBalance(userId)).toBe(10);
    await app.inject({ method: 'PATCH', url: `/tasks/${t.id}/complete`, headers }); // снял
    await app.inject({ method: 'PATCH', url: `/tasks/${t.id}/complete`, headers }); // снова
    await settle();
    expect(await coinBalance(userId)).toBe(10);
  });

  it('привычка за сегодня → +5; задним числом — 0; дневник — раз в день', async () => {
    const { userId, headers } = await user('habit');
    const h = await prisma.habit.create({ data: { userId, name: 'Вода', category: 'health', frequency: 'daily' } });
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await app.inject({ method: 'POST', url: `/habits/${h.id}/log`, headers, payload: { date: '2020-01-01', completed: true } });
    await settle();
    expect(await coinBalance(userId)).toBe(0);
    await app.inject({ method: 'POST', url: `/habits/${h.id}/log`, headers, payload: { date: todayStr(), completed: true } });
    await settle();
    expect(await coinBalance(userId)).toBe(5);
    await app.inject({ method: 'POST', url: '/journal', headers, payload: { date: todayStr(), mood: 7 } });
    await app.inject({ method: 'POST', url: '/journal', headers, payload: { date: todayStr(), mood: 8 } });
    await settle();
    expect(await coinBalance(userId)).toBe(10);
  });

  it('день на 100%: последняя задача закрыта при всех привычках → +30 бонус', async () => {
    const { userId } = await user('day');
    const h = await prisma.habit.create({ data: { userId, name: 'Вода', category: 'health', frequency: 'daily' } });
    await prisma.habitLog.create({ data: { userId, habitId: h.id, date: today(), completed: true } });
    const t = await prisma.task.create({
      data: { userId, title: 'Единственная', category: 'work', priority: 'low', date: today(), completed: true },
    });
    await onTaskCompleted(userId, t.id, t.title); // путь мозга (инструмент complete_task)
    expect(await coinBalance(userId)).toBe(10 + 30);
  });

  it('мозг: инструменты complete_habit и complete_task тоже начисляют', async () => {
    const { userId } = await user('brain');
    await prisma.habit.create({ data: { userId, name: 'Зарядка', category: 'health', frequency: 'daily' } });
    await prisma.habit.create({ data: { userId, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await prisma.task.create({ data: { userId, title: 'Позвонить маме', category: 'personal', priority: 'low', date: today() } });
    await prisma.task.create({ data: { userId, title: 'Другое', category: 'personal', priority: 'low', date: today() } });
    await completeHabitTool.handler({ name: 'зарядку' } as never, { userId } as never);
    await completeTaskTool.handler({ title: 'позвонить маме' } as never, { userId } as never);
    expect(await coinBalance(userId)).toBe(5 + 10);
  });

  it('дневной лимит 300 (подарок не считается)', async () => {
    const { userId } = await user('cap');
    for (let i = 0; i < 40; i++) await awardCoins(userId, `task:cap-${i}`, 10, 'x');
    expect(await coinBalance(userId)).toBe(300);
    await awardCoins(userId, 'start', 200, 'подарок');
    expect(await coinBalance(userId)).toBe(500);
  });

  it('параллельные начисления не пробивают лимит', async () => {
    const { userId } = await user('race');
    await Promise.all(Array.from({ length: 40 }, (_, i) => awardCoins(userId, `task:r-${i}`, 10, 'x')));
    expect(await coinBalance(userId)).toBe(300);
  });
});
