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
const put = (headers: Record<string, string>, placements: Array<{ id: string; slot: string | null }>) =>
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
  it('хватает → предмет в первой свободной ячейке, монеты списаны', async () => {
    const { userId, headers } = await user('buy', 500);
    const res = await buy(headers, 'mid:wardrobe');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ item: { itemKey: 'wardrobe', variantKey: 'mid:wardrobe', slot: 'floor-back-left' }, balance: 150 });
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

  it('часы на пол нельзя; в занятую ячейку — старый предмет уходит в кладовку', async () => {
    const { headers } = await user('slot', 1000);
    expect((await buy(headers, 'budget:clock', 'floor-back-left')).statusCode).toBe(400);
    const sofa = (await buy(headers, 'budget:sofa', 'floor-mid-left')).json().item as Item;
    const desk = (await buy(headers, 'budget:desk', 'floor-mid-left')).json().item as Item;
    const items = await get(headers);
    expect(items.find((i) => i.id === desk.id)?.slot).toBe('floor-mid-left');
    expect(items.find((i) => i.id === sofa.id)?.slot).toBeNull();
  });

  it('новая отделка стен заменяет старую, старая — в кладовке', async () => {
    const { headers } = await user('walls', 1000);
    const a = (await buy(headers, 'budget:walls')).json().item as Item;
    const b = (await buy(headers, 'mid:walls')).json().item as Item;
    expect(b.slot).toBe('finish-walls');
    expect((await get(headers)).find((i) => i.id === a.id)?.slot).toBeNull();
  });

  it('ячейки кончились → покупка уходит в кладовку', async () => {
    const { headers } = await user('full', 0);
    for (let i = 0; i < 3; i++) await buy(headers, 'free:picture');
    const res = await buy(headers, 'free:picture');
    expect(res.json().item.slot).toBeNull();
  });
});

describe('PUT /room — перестановка по ячейкам', () => {
  it('обмен местами двух предметов', async () => {
    const { headers } = await user('swap', 500);
    const a = (await buy(headers, 'budget:sofa', 'floor-back-left')).json().item as Item;
    const b = (await buy(headers, 'budget:desk', 'floor-back-right')).json().item as Item;
    const res = await put(headers, [
      { id: a.id, slot: 'floor-back-right' },
      { id: b.id, slot: 'floor-back-left' },
    ]);
    expect(res.statusCode).toBe(200);
    const items = await get(headers);
    expect(items.find((i) => i.id === a.id)?.slot).toBe('floor-back-right');
    expect(items.find((i) => i.id === b.id)?.slot).toBe('floor-back-left');
  });

  it('два предмета в одну ячейку → 409; стенное на пол → 400; чужой предмет → 404', async () => {
    const { headers } = await user('bad', 500);
    const a = (await buy(headers, 'budget:sofa', 'floor-back-left')).json().item as Item;
    const b = (await buy(headers, 'budget:desk', 'floor-back-right')).json().item as Item;
    const c = (await buy(headers, 'budget:clock')).json().item as Item;
    expect((await put(headers, [{ id: b.id, slot: 'floor-back-left' }])).statusCode).toBe(409);
    expect((await put(headers, [{ id: c.id, slot: 'floor-front-left' }])).statusCode).toBe(400);
    const other = await user('other', 500);
    expect((await put(other.headers, [{ id: a.id, slot: null }])).statusCode).toBe(404);
    expect((await get(headers)).find((i) => i.id === a.id)?.slot).toBe('floor-back-left');
  });

  it('убрать в кладовку и вернуть бесплатно', async () => {
    const { userId, headers } = await user('store', 500);
    const a = (await buy(headers, 'budget:sofa')).json().item as Item;
    const before = await coinBalance(userId);
    await put(headers, [{ id: a.id, slot: null }]);
    expect((await get(headers))[0].slot).toBeNull();
    await put(headers, [{ id: a.id, slot: 'floor-front-right' }]);
    expect((await get(headers))[0].slot).toBe('floor-front-right');
    expect(await coinBalance(userId)).toBe(before);
  });
});

describe('мебель Части 4 переезжает в ячейки', () => {
  it('старые предметы → бюджет/декор в свободных ячейках, лишнее — в кладовку', async () => {
    const { userId, headers } = await user('legacy');
    await prisma.roomItem.createMany({
      data: [
        { userId, itemKey: 'sofa', x: 0.2, y: 0.7 },
        { userId, itemKey: 'clock', x: 0.3, y: 0.3 },
        ...Array.from({ length: 3 }, () => ({ userId, itemKey: 'picture', x: 0.5, y: 0.3 })),
      ],
    });
    const items = await get(headers);
    expect(items.find((i) => i.itemKey === 'sofa')).toMatchObject({ variantKey: 'budget:sofa', slot: 'floor-back-left' });
    expect(items.filter((i) => i.slot?.startsWith('wall-'))).toHaveLength(3);
    expect(items.filter((i) => i.slot === null)).toHaveLength(1);
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
