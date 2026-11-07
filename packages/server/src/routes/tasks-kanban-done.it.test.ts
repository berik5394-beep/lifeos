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
