import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from '../routes/auth.js';
import { gatherAssistantContext } from './assistant-service.js';

// Робот-друг №5: переключатель «режим поддержки» в настройках — реальный путь
// приложения: PATCH /auth/profile → /auth/me → контекст мозга (AND-гейт оркестратора).
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([authRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('робот-друг №5: режим поддержки', () => {
  it('по умолчанию включён; выключение доходит до мозга; другие настройки целы', async () => {
    const u = (await prisma.user.create({
      data: { email: `sm-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC', settings: { checkIns: false } },
    })).id;
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u })}` };
    const me = () => app.inject({ method: 'GET', url: '/auth/me', headers }).then((r) => r.json().user);
    expect((await me()).therapeuticMode).toBe(true);
    expect((await gatherAssistantContext(u, 'привет', { action: 'ask_assistant', question: 'привет' }))?.context.therapeuticMode).toBe(true);

    const off = await app.inject({ method: 'PATCH', url: '/auth/profile', headers, payload: { therapeuticMode: false } });
    expect(off.statusCode).toBe(200);
    expect((await me()).therapeuticMode).toBe(false);
    expect((await me()).checkIns).toBe(false);
    expect((await gatherAssistantContext(u, 'привет', { action: 'ask_assistant', question: 'привет' }))?.context.therapeuticMode).toBe(false);

    await app.inject({ method: 'PATCH', url: '/auth/profile', headers, payload: { therapeuticMode: true } });
    expect((await me()).therapeuticMode).toBe(true);
  });

  it('не булево значение — отказ', async () => {
    const u = (await prisma.user.create({ data: { email: `sm2-${Date.now()}@a.test`, name: 'Б', passwordHash: 'x' } })).id;
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers: { authorization: `Bearer ${app.jwt.sign({ sub: u })}` }, payload: { therapeuticMode: 'нет' } });
    expect(r.statusCode).toBe(400);
  });
});
