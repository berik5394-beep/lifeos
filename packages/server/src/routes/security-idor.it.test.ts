import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { taskRoutes } from './tasks.js';
import { notificationRoutes } from './notifications.js';

/**
 * Аудит безопасности 2026-11-08 — настоящие роуты и тест-БД:
 *  - PUT /tasks/:id с parentId ЧУЖОЙ задачи (B.3 закрывал только POST);
 *  - refresh-токен в роли обычного (отозванный жил бы ещё 30 дней).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([taskRoutes, notificationRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `sec-${tag}-${Date.now()}@a.test`, name: 'S', passwordHash: 'x', timezone: 'UTC' },
  });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const task = (userId: string, title: string) =>
  prisma.task.create({ data: { userId, title, category: 'work', priority: 'medium', date: new Date('2026-12-01T00:00:00Z') } });

describe('PUT /tasks/:id — parentId только своей задачи', () => {
  it('чужая задача как родитель → 404, ничего не меняется', async () => {
    const a = await user('a');
    const b = await user('b');
    const mine = await task(a.userId, 'Моя');
    const foreign = await task(b.userId, 'Чужая');
    const r = await app.inject({ method: 'PUT', url: `/tasks/${mine.id}`, headers: a.headers, payload: { parentId: foreign.id } });
    expect(r.statusCode).toBe(404);
    expect((await prisma.task.findUnique({ where: { id: mine.id } }))?.parentId).toBeNull();
    // У B в подзадачах ничего чужого не появилось.
    expect(await prisma.task.count({ where: { parentId: foreign.id } })).toBe(0);
  });

  it('сама себе родитель → 404; своя задача → ок', async () => {
    const a = await user('self');
    const t = await task(a.userId, 'Задача');
    const p = await task(a.userId, 'Родитель');
    expect((await app.inject({ method: 'PUT', url: `/tasks/${t.id}`, headers: a.headers, payload: { parentId: t.id } })).statusCode).toBe(404);
    const ok = await app.inject({ method: 'PUT', url: `/tasks/${t.id}`, headers: a.headers, payload: { parentId: p.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().parentId).toBe(p.id);
  });
});

describe('refresh-токен не пускает в обычные роуты', () => {
  it('Bearer refresh → 401; обычный → 200', async () => {
    const a = await user('rt');
    const refresh = app.jwt.sign({ sub: a.userId, type: 'refresh', jti: 'x' });
    expect((await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: `Bearer ${refresh}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/tasks', headers: a.headers })).statusCode).toBe(200);
  });
});

describe('пуш-токен принадлежит телефону', () => {
  it('вышел из A, вошёл в B → тот же токен снят с A (пуши вышедшего не идут)', async () => {
    const a = await user('pa');
    const b = await user('pb');
    const token = `ExponentPushToken[sec-${Date.now()}]`;
    expect((await app.inject({ method: 'POST', url: '/notifications/register-token', headers: a.headers, payload: { token } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/notifications/register-token', headers: b.headers, payload: { token } })).statusCode).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: a.userId } }))?.expoPushToken).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: b.userId } }))?.expoPushToken).toBe(token);
  });
});
