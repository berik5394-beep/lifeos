import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { chatRoutes } from './chat.js';

/** Аудит 2026-11-09: «Ещё» в истории — курсором, без пропусков. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([chatRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('GET /chat/history?before=', () => {
  it('отдаёт строго старше курсора, по убыванию', async () => {
    const u = await prisma.user.create({ data: { email: `ch-${Date.now()}-${Math.random()}@a.test`, name: 'C', passwordHash: 'x' } });
    for (let i = 0; i < 5; i++) {
      await prisma.chatMessage.create({ data: { userId: u.id, role: 'user', content: `m${i}`, createdAt: new Date(Date.UTC(2026, 10, 9, 10, i)) } });
    }
    const h = { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` };
    const r = await app.inject({ method: 'GET', url: `/chat/history?limit=2&before=${encodeURIComponent(new Date(Date.UTC(2026, 10, 9, 10, 3)).toISOString())}`, headers: h });
    expect((r.json() as Array<{ content: string }>).map((m) => m.content)).toEqual(['m2', 'm1']);
  });
});
