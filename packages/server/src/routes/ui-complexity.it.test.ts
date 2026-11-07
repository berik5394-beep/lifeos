import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';

/** Berik: «ставлю Продвинутый — должно держаться для юзера». Уровень интерфейса — в аккаунте. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([authRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
const user = async () => {
  const u = await prisma.user.create({
    data: { email: `ui-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', settings: { checkIns: false, portrait: { text: 't' } } },
  });
  return { id: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
};

describe('уровень интерфейса в аккаунте', () => {
  it('нового нет — null; сохранили «Продвинутый» — /auth/me отдаёт его, другие настройки целы', async () => {
    const u = await user();
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: u.headers })).json().user.uiComplexity).toBeNull();
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { uiComplexity: 'power' } });
    expect(r.statusCode).toBe(200);
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: u.headers })).json().user;
    expect(me.uiComplexity).toBe('power');
    expect(me.checkIns).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { settings: true } });
    expect(row.settings).toMatchObject({ checkIns: false, portrait: { text: 't' }, uiComplexity: 'power' });
  });

  it('мусор не принимается', async () => {
    const u = await user();
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { uiComplexity: 'god' } });
    expect(r.statusCode).toBe(400);
  });

  it('смена уровня не пишется в память робота', async () => {
    const u = await user();
    await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { uiComplexity: 'simple' } });
    await new Promise((res) => setTimeout(res, 200));
    const n = await prisma.memory.count({ where: { userId: u.id, content: { contains: 'Настройки' } } });
    expect(n).toBe(0);
  });
});
