import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from './tasks.js';

/** Канбан: задача, записанная сразу в «Готово», — выполнена (как при переносе туда). */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([taskRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('POST /tasks с kanbanStatus', () => {
  it('«Готово» → completed; «В работе» → не выполнена', async () => {
    const u = await prisma.user.create({ data: { email: `kd-${Date.now()}-${Math.random()}@a.test`, name: 'K', passwordHash: 'x', timezone: 'UTC' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const base = { category: 'personal', priority: 'medium', date: '2026-11-07' };
    const done = await app.inject({ method: 'POST', url: '/tasks', headers, payload: { ...base, title: 'Сделано', kanbanStatus: 'done' } });
    const doing = await app.inject({ method: 'POST', url: '/tasks', headers, payload: { ...base, title: 'Делаю', kanbanStatus: 'in_progress' } });
    expect(done.json()).toMatchObject({ kanbanStatus: 'done', completed: true });
    expect(doing.json()).toMatchObject({ kanbanStatus: 'in_progress', completed: false });
  });
});

describe('Галочка ⇄ колонка «Готово» + время переезда', () => {
  it('отметил выполненной → «Готово»; снял → «К выполнению»; переезд пишет kanbanMovedAt', async () => {
    const u = await prisma.user.create({ data: { email: `kd2-${Date.now()}-${Math.random()}@a.test`, name: 'K', passwordHash: 'x', timezone: 'UTC' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const created = await app.inject({
      method: 'POST', url: '/tasks', headers,
      payload: { category: 'personal', priority: 'medium', date: '2026-11-07', title: 'Сайт', kanbanStatus: 'in_progress' },
    });
    const id = created.json().id as string;
    expect(created.json().kanbanMovedAt).toBeTruthy();

    // Галочка в списке задач → карточка уезжает в «Готово».
    const toggled = await app.inject({ method: 'PATCH', url: `/tasks/${id}/complete`, headers });
    expect(toggled.json()).toMatchObject({ completed: true, kanbanStatus: 'done' });
    // Сняли галочку → обратно «К выполнению».
    const back = await app.inject({ method: 'PATCH', url: `/tasks/${id}/complete`, headers });
    expect(back.json()).toMatchObject({ completed: false, kanbanStatus: 'todo' });
    // Через карточку задачи (PUT completed) — то же правило.
    const put = await app.inject({ method: 'PUT', url: `/tasks/${id}`, headers, payload: { completed: true } });
    expect(put.json()).toMatchObject({ completed: true, kanbanStatus: 'done' });

    // Переезд по доске обновляет время; та же колонка — нет.
    await prisma.task.update({ where: { id }, data: { kanbanStatus: 'todo', completed: false, kanbanMovedAt: new Date('2026-01-01T00:00:00Z') } });
    const moved = await app.inject({ method: 'PATCH', url: `/tasks/${id}/kanban`, headers, payload: { status: 'in_progress' } });
    expect(new Date(moved.json().kanbanMovedAt).getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
    const stay = await prisma.task.findUniqueOrThrow({ where: { id } });
    const same = await app.inject({ method: 'PATCH', url: `/tasks/${id}/kanban`, headers, payload: { status: 'in_progress' } });
    expect(new Date(same.json().kanbanMovedAt).getTime()).toBe(stay.kanbanMovedAt!.getTime());
  });
});
