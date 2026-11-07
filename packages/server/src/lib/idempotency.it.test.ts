import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { financeRoutes } from '../routes/finance.js';
import { taskRoutes } from '../routes/tasks.js';

/** Офлайн-очередь повторила запись (ответ потерялся в сети) — дубля быть не должно. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([financeRoutes, taskRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

async function user() {
  const u = await prisma.user.create({ data: { email: `id-${Date.now()}-${Math.random()}@a.test`, name: 'I', passwordHash: 'x', timezone: 'UTC' } });
  return { id: u.id, auth: `Bearer ${app.jwt.sign({ sub: u.id })}` };
}
const expense = { date: '2026-11-07', category: 'food', description: 'обед', amount: 3000 };

describe('Idempotency-Key на записях', () => {
  it('повтор траты с тем же ключом → тот же ответ, одна запись', async () => {
    const u = await user();
    const headers = { authorization: u.auth, 'idempotency-key': 'exp-key-0001' };
    const a = await app.inject({ method: 'POST', url: '/finance/expenses', headers, payload: expense });
    const b = await app.inject({ method: 'POST', url: '/finance/expenses', headers, payload: expense });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    expect(await prisma.expense.count({ where: { userId: u.id } })).toBe(1);
  });

  it('две одинаковые траты с РАЗНЫМИ ключами (две чашки кофе) → две записи; без ключа — как раньше', async () => {
    const u = await user();
    await app.inject({ method: 'POST', url: '/finance/expenses', headers: { authorization: u.auth, 'idempotency-key': 'coffee-0001' }, payload: expense });
    await app.inject({ method: 'POST', url: '/finance/expenses', headers: { authorization: u.auth, 'idempotency-key': 'coffee-0002' }, payload: expense });
    await app.inject({ method: 'POST', url: '/finance/expenses', headers: { authorization: u.auth }, payload: expense });
    expect(await prisma.expense.count({ where: { userId: u.id } })).toBe(3);
  });

  it('ключ одного юзера не мешает другому; задачи тоже защищены', async () => {
    const a = await user();
    const b = await user();
    const task = { title: 'купить хлеб', category: 'personal', priority: 'medium', date: '2026-11-07' };
    await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: a.auth, 'idempotency-key': 'shared-key-01' }, payload: task });
    await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: a.auth, 'idempotency-key': 'shared-key-01' }, payload: task });
    await app.inject({ method: 'POST', url: '/tasks', headers: { authorization: b.auth, 'idempotency-key': 'shared-key-01' }, payload: task });
    expect(await prisma.task.count({ where: { userId: a.id } })).toBe(1);
    expect(await prisma.task.count({ where: { userId: b.id } })).toBe(1);
  });
});
