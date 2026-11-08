import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { briefingRoutes } from '../routes/briefing.js';
import { rememberBrief } from './today-brief.js';
import { localDateStr } from '../lib/tz.js';

/**
 * Утренний бриф в приложении = тот же, что в пуше (аудит проводки 2026-11-08):
 * раньше в приложении утром была общая фраза, бриф жил только в пуше.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([briefingRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `brief-${tag}-${Date.now()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const TODAY = localDateStr('UTC', new Date());

describe('GET /briefing/today', () => {
  it('факты дня из базы (без ключа ИИ — честный шаблон), день, в историю чата один раз', async () => {
    const { userId, headers } = await user('a');
    await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'high', date: new Date(`${TODAY}T00:00:00Z`) } });
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date(`${TODAY}T00:00:00Z`), startTime: '10:00' } });
    const r = await app.inject({ method: 'GET', url: '/briefing/today', headers });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.title).toBe('Доброе утро, Берик.');
    expect(b.text).toContain('1 задача на сегодня');
    expect(b.text).toContain('первая в 10:00 — «Планёрка»');
    expect(b.day).toBe(TODAY);
    await app.inject({ method: 'GET', url: '/briefing/today', headers });
    expect(await prisma.chatMessage.count({ where: { userId, role: 'assistant', content: b.text } })).toBe(1);
  });

  it('бриф, уже сочинённый для пуша, — ровно он же в приложении', async () => {
    const { userId, headers } = await user('b');
    rememberBrief(userId, TODAY, { title: 'Доброе утро, Берик.', text: 'Сегодня 3 задачи и долг Серику до пятницы. Начнём?' });
    const b = (await app.inject({ method: 'GET', url: '/briefing/today', headers })).json();
    expect(b.text).toBe('Сегодня 3 задачи и долг Серику до пятницы. Начнём?');
  });
});
