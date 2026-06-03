import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';
import { taskRoutes } from './tasks.js';

const prisma = new PrismaClient();
const app = await buildTestApp([authRoutes, taskRoutes]);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function userWithToken(email: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, name: 'User', password: 'Str0ng!Passw0rd' },
  });
  return r.json().accessToken as string;
}

describe('cross-user изоляция задач', () => {
  it('B не видит и не может удалить задачу A', async () => {
    const tokenA = await userWithToken('iso-a@a.test');
    const tokenB = await userWithToken('iso-b@a.test');

    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        title: 'A-секрет',
        category: 'personal',
        priority: 'medium',
        date: '2026-06-03',
      },
    });
    expect(created.statusCode).toBeLessThan(300);
    const taskId = created.json().id as string;

    // B читает список → НЕ видит задачу A
    const listB = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const idsB = (listB.json() as Array<{ id: string }>).map((t) => t.id);
    expect(idsB).not.toContain(taskId);

    // B пытается удалить задачу A → отказ (404/403), и строка A ЦЕЛА в БД
    const delB = await app.inject({
      method: 'DELETE',
      url: `/tasks/${taskId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(delB.statusCode);
    expect(await prisma.task.findUnique({ where: { id: taskId } })).not.toBeNull();

    // A удаляет свою → ок
    const delA = await app.inject({
      method: 'DELETE',
      url: `/tasks/${taskId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delA.statusCode).toBeLessThan(300);
  });
});
