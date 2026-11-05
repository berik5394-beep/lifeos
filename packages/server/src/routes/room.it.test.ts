import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { roomRoutes } from './room.js';

/**
 * Робот-эпик, Часть 4: комната робота — расстановка мебели хранится на сервере.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([roomRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `room-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const get = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/room', headers });
const put = (headers: Record<string, string>, items: unknown) =>
  app.inject({ method: 'PUT', url: '/room', headers, payload: { items } });

describe('/room — расстановка мебели', () => {
  it('пустая комната → []', async () => {
    const { headers } = await user('empty');
    const res = await get(headers);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('PUT → GET отдаёт тот же набор; повторный PUT заменяет целиком', async () => {
    const { headers } = await user('put');
    expect((await put(headers, [{ itemKey: 'sofa', x: 0.2, y: 0.7 }, { itemKey: 'plant', x: 0.8, y: 0.6 }])).statusCode).toBe(200);
    let items = (await get(headers)).json().items as Array<{ itemKey: string; x: number; y: number }>;
    expect(items.map((i) => i.itemKey).sort()).toEqual(['plant', 'sofa']);
    expect(items.find((i) => i.itemKey === 'sofa')).toMatchObject({ x: 0.2, y: 0.7 });
    await put(headers, [{ itemKey: 'lamp', x: 0.5, y: 0.5 }]);
    items = (await get(headers)).json().items;
    expect(items.map((i) => i.itemKey)).toEqual(['lamp']);
  });

  it.each([
    ['чужой предмет', [{ itemKey: 'rocket', x: 0.5, y: 0.5 }]],
    ['x за пределами комнаты', [{ itemKey: 'sofa', x: 1.5, y: 0.5 }]],
    ['больше 30 предметов', Array.from({ length: 31 }, () => ({ itemKey: 'books', x: 0.1, y: 0.1 }))],
  ])('%s → 400, расстановка не меняется', async (_n, items) => {
    const { headers } = await user('bad');
    await put(headers, [{ itemKey: 'clock', x: 0.3, y: 0.3 }]);
    expect((await put(headers, items)).statusCode).toBe(400);
    expect(((await get(headers)).json().items as unknown[]).length).toBe(1);
  });

  it('чужую комнату не видно; удаление юзера стирает его предметы', async () => {
    const a = await user('a');
    const b = await user('b');
    await put(a.headers, [{ itemKey: 'plush', x: 0.4, y: 0.4 }]);
    expect(((await get(b.headers)).json().items as unknown[]).length).toBe(0);
    await prisma.user.delete({ where: { id: a.userId } });
    expect(await prisma.roomItem.count({ where: { userId: a.userId } })).toBe(0);
  });
});

describe('/room — одновременные сохранения', () => {
  it('два PUT одновременно → в БД ровно один из наборов, без дублей', async () => {
    const { userId, headers } = await user('race');
    await put(headers, [{ itemKey: 'clock', x: 0.1, y: 0.1 }]);
    const a = [{ itemKey: 'sofa', x: 0.2, y: 0.7 }, { itemKey: 'lamp', x: 0.5, y: 0.5 }];
    const b = [{ itemKey: 'plant', x: 0.8, y: 0.6 }, { itemKey: 'rug', x: 0.4, y: 0.9 }];
    for (let i = 0; i < 5; i++) {
      const [ra, rb] = await Promise.all([put(headers, a), put(headers, b)]);
      expect(ra.statusCode).toBe(200);
      expect(rb.statusCode).toBe(200);
      const keys = (await prisma.roomItem.findMany({ where: { userId }, select: { itemKey: true } }))
        .map((r) => r.itemKey)
        .sort();
      expect([['lamp', 'sofa'], ['plant', 'rug']]).toContainEqual(keys);
    }
  });
});
