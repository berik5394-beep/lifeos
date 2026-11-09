import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { visionRoutes, normalizeCapturedTasks } from './vision.js';

/** Аудит 2026-11-09: одно битое поле с фото больше не роняет сохранение всех задач. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([visionRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('сохранение задач с фото', () => {
  it('time: null, «urgent», пустое название → сохранены остальные', async () => {
    const u = await prisma.user.create({ data: { email: `vc-${Date.now()}-${Math.random()}@a.test`, name: 'V', passwordHash: 'x', timezone: 'UTC' } });
    const r = await app.inject({
      method: 'POST',
      url: '/vision/save-captured-tasks',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` },
      payload: {
        tasks: [
          { title: 'Купить молоко', time: null, priority: 'urgent', category: 'shopping' },
          { title: '   ', priority: 'low' },
          { title: 'Позвонить в банк', time: '14:00', notes: null },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().created).toBe(2);
    const tasks = await prisma.task.findMany({ where: { userId: u.id }, orderBy: { title: 'asc' } });
    expect(tasks.map((t) => [t.title, t.priority, t.category, t.time])).toEqual([
      ['Купить молоко', 'medium', 'personal', null],
      ['Позвонить в банк', 'medium', 'personal', '14:00'],
    ]);
  });

  it('все названия пустые → понятная ошибка, а не тихий ноль', async () => {
    const u = await prisma.user.create({ data: { email: `vc2-${Date.now()}-${Math.random()}@a.test`, name: 'V', passwordHash: 'x', timezone: 'UTC' } });
    const r = await app.inject({ method: 'POST', url: '/vision/save-captured-tasks', headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` }, payload: { tasks: [{ title: '' }] } });
    expect(r.statusCode).toBe(400);
  });

  it('импорт расписания: null-поля и пара без предмета не роняют остальное', async () => {
    const u = await prisma.user.create({ data: { email: `vs-${Date.now()}-${Math.random()}@a.test`, name: 'V', passwordHash: 'x', timezone: 'UTC' } });
    const r = await app.inject({
      method: 'POST',
      url: '/vision/import-schedule',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` },
      payload: { items: [{ day: 'Понедельник', time: null, subject: 'Математика', room: 205, teacher: null }, { subject: '' }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().created).toBe(1);
  });

  it('normalizeCapturedTasks — ответ модели в форму приложения', () => {
    expect(normalizeCapturedTasks([{ title: 'x', time: null, priority: 'HIGH' }])).toEqual([
      { title: 'x', category: 'personal', priority: 'high', time: undefined, notes: undefined },
    ]);
  });
});
