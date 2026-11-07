import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const handleMessage = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ reply: 'ок', intent: 'unknown' }));
vi.mock('../services/jarvis-orchestrator.js', () => ({
  handleMessage: (...a: unknown[]) => handleMessage(...a),
  runConfirmedAction: vi.fn(),
  dealChoiceHint: vi.fn(),
}));
const { buildTestApp } = await import('../../test/integration/build-test-app.js');
const { chatRoutes } = await import('./chat.js');

/** Джарвис-голос (jarvis-roadmap №5): сказано голосом → мозг в коротком голосовом режиме. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([chatRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('/voice/chat — голос', () => {
  it('voice:true → channel voice; без него — как раньше', async () => {
    const u = await prisma.user.create({ data: { email: `cv-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    await app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text: 'привет', voice: true } });
    expect(handleMessage).toHaveBeenLastCalledWith(u.id, 'привет', 'voice');
    await app.inject({ method: 'POST', url: '/voice/chat', headers, payload: { text: 'привет' } });
    expect(handleMessage).toHaveBeenLastCalledWith(u.id, 'привет', undefined);
  });
});

describe('/voice/chat/stream — потоковый ответ', () => {
  it('куски текста по мере генерации, затем итог (streamed для сверки)', async () => {
    const u = await prisma.user.create({ data: { email: `cs-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    handleMessage.mockImplementationOnce(async (...a: unknown[]) => {
      const opts = a[3] as { onText?: (x: string) => void };
      opts.onText?.('Сегодня три ');
      opts.onText?.('задачи. Начни с отчёта.');
      return { reply: 'Сегодня три задачи. Начни с отчёта.', intent: 'unknown', emotion: 'happy' };
    });
    const r = await app.inject({ method: 'POST', url: '/voice/chat/stream', headers, payload: { text: 'что сегодня', voice: true } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/ndjson/);
    const lines = r.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { t: 'd', x: 'Сегодня три ' },
      { t: 'd', x: 'задачи. Начни с отчёта.' },
      {
        t: 'done',
        message: 'Сегодня три задачи. Начни с отчёта.',
        intent: 'unknown',
        pendingAction: null,
        emotion: 'happy',
        openPanel: null,
        streamed: 'Сегодня три задачи. Начни с отчёта.',
      },
    ]);
    expect(handleMessage).toHaveBeenLastCalledWith(u.id, 'что сегодня', 'voice', expect.objectContaining({ onText: expect.any(Function) }));
  });

  it('сбой мозга — строка error, поток закрыт', async () => {
    const u = await prisma.user.create({ data: { email: `ce-${Date.now()}@a.test`, name: 'A', passwordHash: 'x' } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    handleMessage.mockRejectedValueOnce(new Error('boom'));
    const r = await app.inject({ method: 'POST', url: '/voice/chat/stream', headers, payload: { text: 'привет' } });
    expect(r.body.trim()).toBe(JSON.stringify({ t: 'error', message: 'Ошибка обработки чата' }));
  });

  it('без входа — 401, поток не начинается', async () => {
    const r = await app.inject({ method: 'POST', url: '/voice/chat/stream', payload: { text: 'привет' } });
    expect(r.statusCode).toBe(401);
  });
});
