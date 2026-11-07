import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

const handleMessage = vi.fn(async (..._a: unknown[]) => ({ reply: 'ок', intent: 'unknown' }));
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
