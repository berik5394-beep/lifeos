import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from '../routes/tasks.js';
import { eventRoutes } from '../routes/events.js';
import { goalRoutes } from '../routes/goals.js';
import { linkTaskToGoal } from './task-goal-link.js';
import { gatherStrategicFacts } from './strategic-view.js';
import { createWeeklyGoalTool } from '../tools/create-weekly-goal.js';
import { localWeekStartUTC } from '../lib/tz.js';

/**
 * Три связки, которых не было (2026-11-08), — настоящие пути, тест-БД:
 *  1) наложение задачи/встречи с ЭКРАНА → conflictWarning для облачка робота;
 *  2) разбор цели недели (экран + чат);
 *  3) задача ↔ годовая цель → детектор «цель стоит» видит шаг.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([taskRoutes, eventRoutes, goalRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `links-${tag}-${Date.now()}@a.test`, name: 'L', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const DAY = '2026-12-01';

describe('наложение с экрана', () => {
  it('задача в 10:30 внутри встречи 10:00–11:00 → conflictWarning; без наложения — нет', async () => {
    const { userId, headers } = await user('task');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date(`${DAY}T00:00:00Z`), startTime: '10:00', endTime: '11:00' } });
    const hit = await app.inject({
      method: 'POST', url: '/tasks', headers,
      payload: { title: 'Позвонить', category: 'work', priority: 'medium', date: DAY, time: '10:30' },
    });
    expect(hit.statusCode).toBe(201);
    expect(hit.json().conflictWarning).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00.');
    const free = await app.inject({
      method: 'POST', url: '/tasks', headers,
      payload: { title: 'Почта', category: 'work', priority: 'medium', date: DAY, time: '15:00' },
    });
    expect(free.json().conflictWarning).toBeUndefined();
  });

  it('встреча поверх задачи со временем → conflictWarning (раньше задачи не учитывались вовсе)', async () => {
    const { userId, headers } = await user('event');
    await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'high', date: new Date(`${DAY}T00:00:00Z`), time: '14:15' } });
    const r = await app.inject({
      method: 'POST', url: '/events', headers,
      payload: { title: 'Встреча с Сериком', date: DAY, startTime: '14:00', endTime: '15:00' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().conflictWarning).toBe('Накладывается на время с задачей «Отчёт» в 14:15.');
  });

  it('уже выполненная задача (сразу в «Готово») — не предупреждаем', async () => {
    const { userId, headers } = await user('done');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date(`${DAY}T00:00:00Z`), startTime: '10:00', endTime: '11:00' } });
    const r = await app.inject({
      method: 'POST', url: '/tasks', headers,
      payload: { title: 'Сделано', category: 'work', priority: 'medium', date: DAY, time: '10:30', kanbanStatus: 'done' },
    });
    expect(r.json().conflictWarning).toBeUndefined();
  });

});

describe('разбор цели недели', () => {
  it('экран: POST /goals/weekly → /intake: привычка по теме + первое занятие, в чат один раз', async () => {
    const { userId, headers } = await user('week');
    await prisma.habit.create({ data: { userId, name: 'Бег', category: 'health', frequency: 'daily' } });
    const monday = localWeekStartUTC('UTC', new Date()).toISOString().slice(0, 10);
    const created = await app.inject({ method: 'POST', url: '/goals/weekly', headers, payload: { weekStart: monday, goalText: 'Бегать три раза' } });
    expect(created.statusCode).toBe(201);
    const r = await app.inject({ method: 'POST', url: `/goals/weekly/${created.json().id}/intake`, headers });
    const text = r.json().text as string;
    expect(text.startsWith('Про цель «Бегать три раза»:\n')).toBe(true);
    expect(text).toContain('Под неё подходит твоя привычка «Бег».');
    expect(text).not.toContain('могу привязать');
    expect(text).toMatch(/Поставить первое занятие на .+\? Скажи «да»\.$/);
    await app.inject({ method: 'POST', url: `/goals/weekly/${created.json().id}/intake`, headers });
    expect(await prisma.chatMessage.count({ where: { userId, role: 'assistant' } })).toBe(1);
  });

  it('цель на ДРУГУЮ неделю → без разбора («до конца этой недели» было бы не о ней)', async () => {
    const { userId, headers } = await user('nextweek');
    const next = new Date(localWeekStartUTC('UTC', new Date()).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const created = await app.inject({ method: 'POST', url: '/goals/weekly', headers, payload: { weekStart: next, goalText: 'Бегать' } });
    const r = await app.inject({ method: 'POST', url: `/goals/weekly/${created.json().id}/intake`, headers });
    expect(r.json().text).toBeNull();
    expect(await prisma.chatMessage.count({ where: { userId } })).toBe(0);
  });

  it('чат: create_weekly_goal дописывает разбор', async () => {
    const a = await user('wtool');
    const on = (await createWeeklyGoalTool.handler({ goalText: 'Медитировать' } as never, { userId: a.userId } as never)) as { message: string };
    expect(on.message).toMatch(/^Цель недели записана: «Медитировать»\. Всего целей на эту неделю: 1\.\n\nПоставить первое занятие/);
  });
});

describe('задача ↔ годовая цель', () => {
  const pickFirst = async () => 0;
  const pickNone = async () => null;

  it('явный шаг → привязана, и детектор «цель стоит» видит шаг', async () => {
    const { userId } = await user('link');
    const now = new Date();
    const goal = await prisma.yearlyGoal.create({
      data: { userId, year: now.getFullYear(), area: 'spirituality', goalText: 'Прочитать 24 книги', createdAt: new Date(now.getTime() - 40 * 86_400_000) },
    });
    const task = await prisma.task.create({
      data: { userId, title: 'Прочитать главу', category: 'personal', priority: 'medium', date: new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z') },
    });
    expect(await linkTaskToGoal(userId, task.id, task.title, now, pickFirst)).toBe('Прочитать 24 книги');
    const row = await prisma.task.findUnique({ where: { id: task.id }, select: { planParentId: true, planParentType: true } });
    expect(row).toEqual({ planParentId: goal.id, planParentType: 'YearlyGoal' });

    await prisma.task.update({ where: { id: task.id }, data: { completed: true } });
    const facts = await gatherStrategicFacts(userId, 'UTC', now);
    expect(facts.goals.find((g) => g.id === goal.id)?.steps).toBe(1);
  });

  it('модель не уверена → не привязываем; уже привязанную (план) не перетираем', async () => {
    const { userId } = await user('nolink');
    const now = new Date();
    await prisma.yearlyGoal.create({ data: { userId, year: now.getFullYear(), area: 'finance', goalText: 'Купить квартиру' } });
    const t1 = await prisma.task.create({ data: { userId, title: 'Купить хлеб', category: 'home', priority: 'low', date: new Date() } });
    expect(await linkTaskToGoal(userId, t1.id, t1.title, now, pickNone)).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: t1.id } }))?.planParentId).toBeNull();

    const t2 = await prisma.task.create({
      data: { userId, title: 'Шаг плана', category: 'home', priority: 'low', date: new Date(), planParentId: 'weekly-x', planParentType: 'WeeklyGoal' },
    });
    expect(await linkTaskToGoal(userId, t2.id, t2.title, now, pickFirst)).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: t2.id } }))?.planParentId).toBe('weekly-x');
  });

  it('чужая цель не видна', async () => {
    const a = await user('own');
    const b = await user('other');
    const now = new Date();
    await prisma.yearlyGoal.create({ data: { userId: b.userId, year: now.getFullYear(), area: 'health', goalText: 'Марафон' } });
    const t = await prisma.task.create({ data: { userId: a.userId, title: 'Пробежка', category: 'health', priority: 'low', date: new Date() } });
    expect(await linkTaskToGoal(a.userId, t.id, t.title, now, pickFirst)).toBeNull(); // у A целей нет
  });
});
