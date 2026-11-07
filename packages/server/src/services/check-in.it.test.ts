import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

// Модель замокана: проверяем гард вопроса и запасной простой вопрос.
const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({ createAnthropic: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }) }));
const { V2ProactivityEngine } = await import('./v2-proactivity-engine.js');
const { checkInQuestionOk, genericCheckIn, GENERIC_CHECK_INS } = await import('./check-in.js');
const { buildTestApp } = await import('../../test/integration/build-test-app.js');
const { authRoutes } = await import('../routes/auth.js');

const prisma = new PrismaClient();
const engine = new V2ProactivityEngine();
let app: FastifyInstance;
const HOUR = 3_600_000;
const KEY = process.env.CLAUDE_API_KEY;
beforeAll(async () => { app = await buildTestApp([authRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
afterEach(() => {
  create.mockReset();
  if (KEY === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = KEY;
});

async function user(settings: object = {}) {
  return (await prisma.user.create({ data: { email: `ci-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC', settings } })).id;
}
const checkIns = async (u: string) => (await engine.detectCandidates(u)).filter((c) => c.source === 'check_in');

describe('робот-друг №2: «как ты?» без повода', () => {
  it('есть свежее воспоминание → вопрос по нему (Haiku), с проверкой', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';
    const u = await user();
    const m = await prisma.memory.create({
      data: { userId: u, type: 'event', content: 'В субботу встреча с мамой', source: 'chat', tags: [], importance: 7, createdAt: new Date(Date.now() - 30 * HOUR) },
    });
    const [c] = await checkIns(u);
    expect(c.entityId).toBe(m.id);
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Как прошла встреча с мамой?' }] });
    expect(await engine.generateNudge(u, c)).toBe('Как прошла встреча с мамой?');
  });

  it('модель выдумала число / не вопрос → простой «как ты?»', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';
    const u = await user();
    await prisma.memory.create({ data: { userId: u, type: 'event', content: 'Встреча с мамой', source: 'chat', tags: [], importance: 7, createdAt: new Date(Date.now() - 30 * HOUR) } });
    const [c] = await checkIns(u);
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Как прошли 3 часа с мамой?' }] });
    expect(GENERIC_CHECK_INS).toContain(await engine.generateNudge(u, c));
  });

  it('нет воспоминаний → простой вопрос без вызова модели', async () => {
    const u = await user();
    const [c] = await checkIns(u);
    expect(c.entityId).toBeUndefined();
    expect(GENERIC_CHECK_INS).toContain(await engine.generateNudge(u, c));
    expect(create).not.toHaveBeenCalled();
  });

  it('молчит: выключено в настройках / писал роботу 2 ч назад / уже спрашивал вчера', async () => {
    const off = await user({ checkIns: false });
    expect(await checkIns(off)).toHaveLength(0);

    const talked = await user();
    await prisma.chatMessage.create({ data: { userId: talked, role: 'user', content: 'привет', createdAt: new Date(Date.now() - 2 * HOUR) } });
    expect(await checkIns(talked)).toHaveLength(0);

    const asked = await user();
    await prisma.insight.create({
      data: { userId: asked, severity: 6, scope: {}, message: 'Как ты?', source: 'v2-proactivity', kind: 'v2_nudge', scopeKey: 'check_in:global', createdAt: new Date(Date.now() - 20 * HOUR) },
    });
    expect(await checkIns(asked)).toHaveLength(0);
  });

  it('настройка через профиль: выключить → /auth/me checkIns=false, другие ключи settings целы', async () => {
    const u = await user({ other: 1 });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u })}` };
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers, payload: { checkIns: false } });
    expect(r.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u } })).settings).toEqual({ other: 1, checkIns: false });
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).json().user.checkIns).toBe(false);
  });
});

describe('гард вопроса', () => {
  it('вопрос, коротко, без выдуманных чисел', () => {
    expect(checkInQuestionOk('Как прошла встреча с мамой?', 'встреча с мамой')).toBe(true);
    expect(checkInQuestionOk('Как прошла встреча с мамой.', 'встреча с мамой')).toBe(false);
    expect(checkInQuestionOk('Как прошли 3 часа?', 'встреча с мамой')).toBe(false);
    expect(checkInQuestionOk('Как?', 'x')).toBe(false);
  });
  it('простые вопросы по кругу', () => {
    expect(genericCheckIn(new Date('2026-11-07T00:00:00Z'))).not.toBe(genericCheckIn(new Date('2026-11-08T00:00:00Z')));
  });
});
