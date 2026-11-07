import type { FastifyInstance } from 'fastify';
import { captureActivity } from '../services/tool-activity-summary.js';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  ROOM_MAX_OWNED,
  ROOM_SLOTS,
  ROOM_TIERS,
  ROOM_VARIANTS,
  TIER_LABEL,
  fitsSlot,
  legacyVariantKey,
  slotsFor,
  variantByKey,
} from '../services/room-catalog.js';
import { getFriendship, titleOfLevel } from '../services/friendship.js';

/**
 * Робот-эпик: комната робота.
 * Часть 4 — мебель на сервере (не теряется, видна мозгу).
 * Часть 6 — ремонт за монеты: варианты по классам, чёткие ячейки (никаких
 * наложений), кладовка (slot = null), покупка списывает монеты в той же
 * транзакции. Замки: покупка берёт 'coins:' (баланс, как начисления) и
 * 'room:' (ячейки), перестановка — только 'room:'. Порядок всегда coins→room.
 */
const SELECT = { id: true, itemKey: true, variantKey: true, slot: true } as const;
type Tx = Prisma.TransactionClient;

const buySchema = z.object({
  variantKey: z.string().max(40),
  slot: z.enum(ROOM_SLOTS).nullable().optional(),
});

const putRoomSchema = z.object({
  placements: z
    .array(z.object({ id: z.string().max(40), slot: z.enum(ROOM_SLOTS).nullable() }))
    .max(ROOM_MAX_OWNED),
});

class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const lockRoom = (tx: Tx, userId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'room:' + userId}))`;

const listItems = (tx: Tx | typeof prisma, userId: string) =>
  tx.roomItem.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: SELECT });

/**
 * Предметы Части 4 (без варианта, свободные x/y) → бюджетный класс/декор и
 * первая свободная подходящая ячейка; не влезло — в кладовку. Разово, под замком.
 */
async function upgradeLegacy(tx: Tx, userId: string): Promise<void> {
  const legacy = await tx.roomItem.findMany({
    where: { userId, variantKey: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (legacy.length === 0) return;
  const taken = new Set(
    (await tx.roomItem.findMany({ where: { userId, slot: { not: null } }, select: { slot: true } })).map((r) => r.slot),
  );
  for (const item of legacy) {
    const vk = legacyVariantKey(item.itemKey);
    const v = variantByKey(vk);
    if (!v) {
      await tx.roomItem.delete({ where: { id: item.id } }); // ключ, которого больше нет
      continue;
    }
    const slot = slotsFor(v).find((s) => !taken.has(s)) ?? null;
    if (slot) taken.add(slot);
    await tx.roomItem.update({ where: { id: item.id }, data: { variantKey: v.key, slot } });
  }
}

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /room/catalog — магазин: классы, варианты с ценами, ячейки (SSOT для мобилки)
  app.get('/room/catalog', async () => ({
    tiers: ROOM_TIERS.map((key) => ({ key, label: TIER_LABEL[key] })),
    variants: ROOM_VARIANTS,
    slots: ROOM_SLOTS,
  }));

  // GET /room — мои предметы: в ячейках и в кладовке (slot = null)
  app.get('/room', async (request) => {
    const userId = request.userId;
    const items = await prisma.$transaction(async (tx) => {
      await lockRoom(tx, userId);
      await upgradeLegacy(tx, userId);
      return listItems(tx, userId);
    });
    return { items };
  });

  // POST /room/buy — купить вариант за монеты и поставить в ячейку (или в кладовку)
  app.post('/room/buy', { preHandler: validate(buySchema) }, async (request, reply) => {
    const { variantKey, slot: wanted } = request.body as z.infer<typeof buySchema>;
    const userId = request.userId;
    const v = variantByKey(variantKey);
    if (!v) return reply.code(400).send({ error: 'Такого предмета нет в каталоге' });
    if (wanted && !fitsSlot(v, wanted)) {
      return reply.code(400).send({ error: v.spot === 'wall' ? 'Это вешается на стену' : 'Это ставится на пол' });
    }
    // Подарок дружбы — только когда уровень дружбы дорос (уровень не падает).
    if (v.minLevel && (await getFriendship(userId)).level < v.minLevel) {
      return reply.code(403).send({ error: `Откроется, когда мы станем «${titleOfLevel(v.minLevel)}»` });
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Тот же замок, что у начислений: баланс не уйдёт в минус при гонке покупок.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'coins:' + userId}))`;
        await lockRoom(tx, userId);
        await upgradeLegacy(tx, userId);
        const owned = await tx.roomItem.findMany({ where: { userId }, select: { variantKey: true, slot: true, id: true } });
        if (owned.length >= ROOM_MAX_OWNED) throw new RoomError(409, 'Кладовка переполнена');
        if ((v.price > 0 || v.tier === 'friend') && owned.some((o) => o.variantKey === v.key)) {
          throw new RoomError(409, 'Это уже есть — загляни в кладовку');
        }
        const sum = await tx.coinTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
        const balance = sum._sum.amount ?? 0;
        if (balance < v.price) {
          throw new RoomError(402, `Не хватает ${v.price - balance} 🪙 — выполняй дела, и монеты придут`);
        }
        const taken = new Map(owned.filter((o) => o.slot).map((o) => [o.slot as string, o.id]));
        let slot: string | null = wanted ?? slotsFor(v).find((s) => !taken.has(s)) ?? null;
        // Отделка заменяет текущую: старая уходит в кладовку. Мебель в занятую
        // ячейку — старая тоже в кладовку (наложений не бывает).
        if (v.spot === 'finish') slot = slotsFor(v)[0];
        if (slot && taken.has(slot)) {
          await tx.roomItem.update({ where: { id: taken.get(slot) as string }, data: { slot: null } });
        }
        const item = await tx.roomItem.create({
          data: { userId, itemKey: v.kind, variantKey: v.key, slot },
          select: SELECT,
        });
        if (v.price > 0) {
          await tx.coinTransaction.create({
            data: { userId, amount: -v.price, reason: `Покупка: ${v.label}`, refKey: `buy:${item.id}` },
          });
        }
        return { item, balance: balance - v.price };
      });
      // Робот должен знать, что ему купили (можно поблагодарить/вспомнить).
      captureActivity(userId, {
        type: 'room_item_bought',
        content: `Купил в комнату робота «${v.label}»${v.price > 0 ? ` за ${v.price} 🪙` : ''}`,
      });
      return result;
    } catch (err) {
      if (err instanceof RoomError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // PUT /room — переставить свои предметы по ячейкам (null = убрать в кладовку)
  app.put('/room', { preHandler: validate(putRoomSchema) }, async (request, reply) => {
    const { placements } = request.body as z.infer<typeof putRoomSchema>;
    const userId = request.userId;
    let movedCount = 0;
    try {
      const items = await prisma.$transaction(async (tx) => {
        await lockRoom(tx, userId);
        await upgradeLegacy(tx, userId);
        const owned = await tx.roomItem.findMany({ where: { userId }, select: { id: true, variantKey: true, slot: true } });
        const byId = new Map(owned.map((o) => [o.id, o]));
        const final = new Map(owned.map((o) => [o.id, o.slot]));
        for (const p of placements) {
          const it = byId.get(p.id);
          if (!it) throw new RoomError(404, 'Предмет не найден');
          const v = variantByKey(it.variantKey);
          if (p.slot && (!v || !fitsSlot(v, p.slot))) {
            throw new RoomError(400, v?.spot === 'wall' ? 'Это вешается на стену' : 'Сюда это не встанет');
          }
          final.set(p.id, p.slot);
        }
        const seen = new Set<string>();
        for (const s of final.values()) {
          if (!s) continue;
          if (seen.has(s)) throw new RoomError(409, 'В одной ячейке может стоять только один предмет');
          seen.add(s);
        }
        // Сначала всех переставляемых — в кладовку, потом по местам (иначе обмен
        // местами споткнётся об уникальность ячейки посередине).
        const moved = placements.filter((p) => byId.get(p.id)?.slot !== p.slot);
        movedCount = moved.length;
        if (moved.length > 0) {
          await tx.roomItem.updateMany({ where: { userId, id: { in: moved.map((p) => p.id) } }, data: { slot: null } });
          for (const p of moved) {
            if (p.slot) await tx.roomItem.update({ where: { id: p.id }, data: { slot: p.slot } });
          }
        }
        return listItems(tx, userId);
      });
      if (movedCount > 0) {
        captureActivity(userId, { type: 'room_rearranged', content: `Переставил мебель в комнате робота (${movedCount})`, importance: 2 });
      }
      return { items };
    } catch (err) {
      if (err instanceof RoomError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
