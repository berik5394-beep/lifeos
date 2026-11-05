import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { integrationRoutes } from './integrations.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([integrationRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Telegram-привязка: роуты', () => {
  it('старый /telegram/connect с произвольным chatId закрыт (410) и ничего не привязывает', async () => {
    const u = await prisma.user.create({ data: { email: `itr-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const res = await app.inject({
      method: 'POST',
      url: '/integrations/telegram/connect',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` },
      payload: { chatId: '777' },
    });
    expect(res.statusCode).toBe(410);
    expect(await prisma.integration.count({ where: { provider: 'telegram', userId: u.id } })).toBe(0);
  });

  it('/telegram/link-code выдаёт код + deep-link в бота', async () => {
    const u = await prisma.user.create({ data: { email: `itr2-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const res = await app.inject({
      method: 'POST',
      url: '/integrations/telegram/link-code',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { code: string; deepLink: string; expiresAt: string };
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.deepLink).toBe(`https://t.me/LifeOS_jarvis_bot?start=link_${body.code}`);
    expect(await prisma.telegramLinkCode.count({ where: { userId: u.id } })).toBe(1);
  });

  it('без токена → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/integrations/telegram/link-code' });
    expect(res.statusCode).toBe(401);
  });
});
