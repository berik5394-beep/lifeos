import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { roomRoutes } from './room.js';
import { awardCoins, coinBalance } from '../services/coins.js';

/**
 * Робот-эпик: комната робота. Часть 4 — мебель на сервере. Часть 6 — ремонт
 * за монеты: покупка, ячейки без наложений, обмен местами, кладовка.
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

interface Item {
  id: string;
  itemKey: string;
  variantKey: string | null;
  slot: string | null;
  surface: string | null;
  x: number;
  y: number;
}

async function user(tag: string, coins = 0) {
  const u = await prisma.user.create({ data: { email: `room-${tag}-${Date.now()}@a.test`, name: 'R', passwordHash: 'x' } });
  if (coins > 0) await awardCoins(u.id, 'start', coins, 'тест');
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const get = async (headers: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: '/room', headers })).json().items as Item[];
const buy = (headers: Record<string, string>, variantKey: string, slot?: string | null) =>
  app.inject({ method: 'POST', url: '/room/buy', headers, payload: slot === undefined ? { variantKey } : { variantKey, slot } });
type Placement = { id: string; slot?: string | null; surface?: string | null; x?: number; y?: number };
const put = (headers: Record<string, string>, placements: Placement[]) =>
  app.inject({ method: 'PUT', url: '/room', headers, payload: { placements } });

describe('/room/catalog', () => {
  it('4 класса, 40 платных вариантов + декор, ячейки', async () => {
    const { headers } = await user('cat');
    const c = (await app.inject({ method: 'GET', url: '/room/catalog', headers })).json();
    expect(c.tiers.map((t: { label: string }) => t.label)).toEqual(['Бюджет', 'Средний', 'Премиум', 'Люкс']);
    expect(c.variants.filter((v: { price: number }) => v.price > 0)).toHaveLength(40);
    expect(c.slots).toContain('finish-walls');
  });
});

describe('/room/buy — покупка за монеты', () => {
  it('хватает → предмет на полу в привычном месте, монеты списаны', async () => {
    const { userId, headers } = await user('buy', 500);
    const res = await buy(headers, 'mid:wardrobe');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      item: { itemKey: 'wardrobe', variantKey: 'mid:wardrobe', surface: 'floor', x: 0.218, y: 0.27, slot: 'floor-back-left' },
      balance: 150,
    });
    expect(await coinBalance(userId)).toBe(150);
  });

  it('не хватает → 402 с понятным текстом, ничего не куплено', async () => {
    const { userId, headers } = await user('poor', 100);
    const res = await buy(headers, 'luxury:sofa');
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatch(/Не хватает 4900/);
    expect(await get(headers)).toHaveLength(0);
    expect(await coinBalance(userId)).toBe(100);
  });

  it('гонка двух покупок на последние монеты → куплен ровно один', async () => {
    const { userId, headers } = await user('race-buy', 400);
    const [a, b] = await Promise.all([buy(headers, 'mid:sofa'), buy(headers, 'mid:wardrobe')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 402]);
    expect(await coinBalance(userId)).toBeGreaterThanOrEqual(0);
    expect(await get(headers)).toHaveLength(1);
  });

  it('платный вариант второй раз — 409 (он в кладовке), декор — сколько угодно', async () => {
    const { headers } = await user('dup', 500);
    await buy(headers, 'budget:desk');
    expect((await buy(headers, 'budget:desk')).statusCode).toBe(409);
    expect((await buy(headers, 'free:plant')).statusCode).toBe(200);
    expect((await buy(headers, 'free:plant')).statusCode).toBe(200);
  });

  it('часы на пол нельзя; приложение до обновления выбрало ячейку → та же точка, без вытеснения', async () => {
    const { headers } = await user('slot', 1000);
    expect((await buy(headers, 'budget:clock', 'floor-back-left')).statusCode).toBe(400);
    const sofa = (await buy(headers, 'budget:sofa', 'floor-mid-left')).json().item as Item;
    const desk = (await buy(headers, 'budget:desk', 'floor-mid-left')).json().item as Item;
    const items = await get(headers);
    expect(items.find((i) => i.id === desk.id)).toMatchObject({ surface: 'floor', x: 0.116, y: 0.581 });
    expect(items.find((i) => i.id === sofa.id)).toMatchObject({ surface: 'floor', x: 0.116, y: 0.581 });
  });

  it('новая отделка стен заменяет старую, старая — в кладовке', async () => {
    const { headers } = await user('walls', 1000);
    const a = (await buy(headers, 'budget:walls')).json().item as Item;
    const b = (await buy(headers, 'mid:walls')).json().item as Item;
    expect(b.slot).toBe('finish-walls');
    expect((await get(headers)).find((i) => i.id === a.id)?.slot).toBeNull();
  });

  it('мест «по умолчанию» не хватает — всё равно в комнате (сдвиг), не в кладовке', async () => {
    const { headers } = await user('full', 0);
    for (let i = 0; i < 4; i++) await buy(headers, 'free:picture');
    const items = await get(headers);
    expect(items.every((i) => i.surface?.startsWith('wall-'))).toBe(true);
    expect(new Set(items.map((i) => `${i.surface}:${i.x}:${i.y}`)).size).toBe(4);
  });

  it('купить сразу в кладовку (slot: null)', async () => {
    const { headers } = await user('to-store', 0);
    const res = await buy(headers, 'free:plant', null);
    expect(res.json().item).toMatchObject({ surface: null, slot: null });
  });
});

describe('PUT /room — свободная расстановка (каждый сам дизайнер)', () => {
  it('ставлю диван в любую точку пола, картину — на левую стену', async () => {
    const { headers } = await user('free', 500);
    const sofa = (await buy(headers, 'budget:sofa')).json().item as Item;
    const pic = (await buy(headers, 'free:picture')).json().item as Item;
    const res = await put(headers, [
      { id: sofa.id, surface: 'floor', x: 0.33, y: 0.72 },
      { id: pic.id, surface: 'wall-left', x: 0.7, y: 0.3 },
    ]);
    expect(res.statusCode).toBe(200);
    const items = await get(headers);
    expect(items.find((i) => i.id === sofa.id)).toMatchObject({ surface: 'floor', x: 0.33, y: 0.72 });
    expect(items.find((i) => i.id === pic.id)).toMatchObject({ surface: 'wall-left', x: 0.7, y: 0.3 });
  });

  it('два предмета рядом — можно (юзер решает); стенное на пол → 400; без точки → 400; чужой → 404', async () => {
    const { headers } = await user('bad', 500);
    const a = (await buy(headers, 'budget:sofa')).json().item as Item;
    const b = (await buy(headers, 'budget:desk')).json().item as Item;
    const c = (await buy(headers, 'budget:clock')).json().item as Item;
    expect((await put(headers, [{ id: b.id, surface: 'floor', x: a.x, y: a.y }])).statusCode).toBe(200);
    expect((await put(headers, [{ id: c.id, surface: 'floor', x: 0.5, y: 0.5 }])).statusCode).toBe(400);
    expect((await put(headers, [{ id: a.id, surface: 'floor' }])).statusCode).toBe(400);
    expect((await put(headers, [{ id: a.id, surface: 'floor', x: 1.5, y: 0.5 }])).statusCode).toBe(400);
    const other = await user('other', 500);
    expect((await put(other.headers, [{ id: a.id, surface: null }])).statusCode).toBe(404);
  });

  it('убрать в кладовку и вернуть бесплатно', async () => {
    const { userId, headers } = await user('store', 500);
    const a = (await buy(headers, 'budget:sofa')).json().item as Item;
    const before = await coinBalance(userId);
    await put(headers, [{ id: a.id, surface: null }]);
    expect((await get(headers))[0]).toMatchObject({ surface: null, slot: null });
    await put(headers, [{ id: a.id, surface: 'floor', x: 0.8, y: 0.8 }]);
    expect((await get(headers))[0]).toMatchObject({ surface: 'floor', x: 0.8, y: 0.8 });
    expect(await coinBalance(userId)).toBe(before);
  });

  it('приложение до обновления шлёт ячейку → та же точка на поверхности', async () => {
    const { headers } = await user('legacy-put', 500);
    const a = (await buy(headers, 'budget:sofa')).json().item as Item;
    expect((await put(headers, [{ id: a.id, slot: 'floor-front-right' }])).statusCode).toBe(200);
    expect((await get(headers))[0]).toMatchObject({ surface: 'floor', x: 0.907, y: 0.85, slot: 'floor-front-right' });
  });

  it('отделка — по-прежнему в своей ячейке', async () => {
    const { headers } = await user('finish-put', 1000);
    const w = (await buy(headers, 'budget:walls')).json().item as Item;
    expect((await put(headers, [{ id: w.id, slot: null }])).statusCode).toBe(200);
    expect((await get(headers))[0].slot).toBeNull();
    expect((await put(headers, [{ id: w.id, slot: 'finish-walls' }])).statusCode).toBe(200);
    expect((await get(headers))[0].slot).toBe('finish-walls');
  });
});

describe('мебель Части 4 переезжает в комнату', () => {
  it('старые предметы → бюджет/декор на привычных местах, все в комнате', async () => {
    const { userId, headers } = await user('legacy');
    await prisma.roomItem.createMany({
      data: [
        { userId, itemKey: 'sofa', x: 0.2, y: 0.7 },
        { userId, itemKey: 'clock', x: 0.3, y: 0.3 },
        ...Array.from({ length: 3 }, () => ({ userId, itemKey: 'picture', x: 0.5, y: 0.3 })),
      ],
    });
    const items = await get(headers);
    expect(items.find((i) => i.itemKey === 'sofa')).toMatchObject({ variantKey: 'budget:sofa', surface: 'floor', slot: 'floor-back-left' });
    expect(items.filter((i) => i.surface?.startsWith('wall-'))).toHaveLength(4);
    expect(items.filter((i) => i.surface === null)).toHaveLength(0);
    expect(await coinBalance(userId)).toBe(0); // старая мебель — даром
  });

  it('чужую комнату не видно; удаление юзера стирает его предметы', async () => {
    const a = await user('a', 200);
    const b = await user('b');
    await buy(a.headers, 'free:plush');
    expect(await get(b.headers)).toHaveLength(0);
    await prisma.user.delete({ where: { id: a.userId } });
    expect(await prisma.roomItem.count({ where: { userId: a.userId } })).toBe(0);
  });
});
