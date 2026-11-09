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
  SLOT_SPOT,
  SURFACES,
  TIER_LABEL,
  defaultSpot,
  fitsSlot,
  fitsSurface,
  isPlaceSlot,
  legacySlotOf,
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
const SELECT = { id: true, itemKey: true, variantKey: true, slot: true, surface: true, x: true, y: true } as const;
type Tx = Prisma.TransactionClient;

const buySchema = z.object({
  variantKey: z.string().max(40),
  slot: z.enum(ROOM_SLOTS).nullable().optional(),
});

/**
 * Перестановка: { id, surface, x, y } — свободно на поверхности (surface null —
 * в кладовку); { id, slot } — отделка, и приложения до обновления (ячейка →
 * та же точка на поверхности).
 */
const putRoomSchema = z.object({
  placements: z
    .array(
      z.object({
        id: z.string().max(40),
        slot: z.enum(ROOM_SLOTS).nullable().optional(),
        surface: z.enum(SURFACES).nullable().optional(),
        x: z.number().min(0).max(1).optional(),
        y: z.number().min(0).max(1).optional(),
      }),
    )
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

/**
 * Предметы для ответа. slot у мебели — ближайшая старая ячейка: приложения до
 * обновления рисуют по ячейкам и иначе решили бы, что всё в кладовке.
 */
const listItems = async (tx: Tx | typeof prisma, userId: string) =>
  (await tx.roomItem.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: SELECT })).map(
    (it) => ({ ...it, slot: it.slot ?? legacySlotOf(it.surface, it.x, it.y) }),
  );

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
  const placed = await tx.roomItem.findMany({ where: { userId, surface: { not: null } }, select: { surface: true, x: true, y: true } });
  for (const item of legacy) {
    const vk = legacyVariantKey(item.itemKey);
    const v = variantByKey(vk);
    if (!v) {
      await tx.roomItem.delete({ where: { id: item.id } }); // ключ, которого больше нет
      continue;
    }
    const spot = defaultSpot(v, placed);
    if (spot) placed.push(spot);
    await tx.roomItem.update({ where: { id: item.id }, data: { variantKey: v.key, slot: null, ...(spot ?? { surface: null }) } });
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

  // GET /room — мои предметы: на поверхностях (surface, x, y), отделка (slot), кладовка
  app.get('/room', async (request) => {
    const userId = request.userId;
    const items = await prisma.$transaction(async (tx) => {
      await lockRoom(tx, userId);
      await upgradeLegacy(tx, userId);
      return listItems(tx, userId);
    });
    return { items };
  });

  // POST /room/buy — купить вариант за монеты и поставить в комнату (или в кладовку)
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
        const owned = await tx.roomItem.findMany({
          where: { userId },
          select: { variantKey: true, slot: true, id: true, surface: true, x: true, y: true },
        });
        if (owned.length >= ROOM_MAX_OWNED) throw new RoomError(409, 'Кладовка переполнена');
        if ((v.price > 0 || v.tier === 'friend') && owned.some((o) => o.variantKey === v.key)) {
          throw new RoomError(409, 'Это уже есть — загляни в кладовку');
        }
        const sum = await tx.coinTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
        const balance = sum._sum.amount ?? 0;
        if (balance < v.price) {
          throw new RoomError(402, `Не хватает ${v.price - balance} 🪙 — выполняй дела, и монеты придут`);
        }
        let place: { slot: string | null; surface: string | null; x?: number; y?: number };
        if (v.spot === 'finish') {
          // Отделка заменяет текущую: старая уходит в кладовку.
          const slot = slotsFor(v)[0];
          const cur = owned.find((o) => o.slot === slot);
          if (cur) await tx.roomItem.update({ where: { id: cur.id }, data: { slot: null } });
          place = { slot, surface: null };
        } else if (wanted === null) {
          place = { slot: null, surface: null }; // сразу в кладовку
        } else if (wanted && isPlaceSlot(wanted)) {
          place = { slot: null, ...SLOT_SPOT[wanted] }; // приложение до обновления выбрало ячейку
        } else {
          // Мебель — на свободное привычное место; дальше юзер двигает куда хочет.
          place = { slot: null, ...(defaultSpot(v, owned) ?? { surface: null }) };
        }
        const created = await tx.roomItem.create({
          data: { userId, itemKey: v.kind, variantKey: v.key, ...place },
          select: SELECT,
        });
        const item = { ...created, slot: created.slot ?? legacySlotOf(created.surface, created.x, created.y) };
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

  // PUT /room — переставить: мебель — в любую точку поверхности, отделку — в её ячейку
  app.put('/room', { preHandler: validate(putRoomSchema) }, async (request, reply) => {
    const { placements } = request.body as z.infer<typeof putRoomSchema>;
    const userId = request.userId;
    let movedCount = 0;
    try {
      const items = await prisma.$transaction(async (tx) => {
        await lockRoom(tx, userId);
        await upgradeLegacy(tx, userId);
        const owned = await tx.roomItem.findMany({
          where: { userId },
          select: { id: true, variantKey: true, slot: true, surface: true, x: true, y: true },
        });
        const byId = new Map(owned.map((o) => [o.id, o]));
        // Отделка — по ячейкам (одна на стены, одна на пол); мебель — свободно.
        const finalSlot = new Map(owned.map((o) => [o.id, o.slot]));
        const spots = new Map<string, { surface: string | null; x?: number; y?: number }>();
        for (const p of placements) {
          const it = byId.get(p.id);
          if (!it) throw new RoomError(404, 'Предмет не найден');
          const v = variantByKey(it.variantKey);
          if (!v) throw new RoomError(400, 'Сюда это не встанет');
          if (v.spot === 'finish') {
            const slot = p.slot ?? null;
            if (slot && !fitsSlot(v, slot)) throw new RoomError(400, 'Сюда это не встанет');
            finalSlot.set(p.id, slot);
            continue;
          }
          if (p.surface !== undefined) {
            if (p.surface === null) spots.set(p.id, { surface: null });
            else {
              if (!fitsSurface(v, p.surface)) {
                throw new RoomError(400, v.spot === 'wall' ? 'Это вешается на стену' : 'Это ставится на пол');
              }
              if (p.x === undefined || p.y === undefined) throw new RoomError(400, 'Нужна точка на поверхности');
              spots.set(p.id, { surface: p.surface, x: p.x, y: p.y });
            }
          } else if (p.slot !== undefined) {
            // Приложение до обновления: ячейка → та же точка; null — в кладовку.
            if (p.slot === null) spots.set(p.id, { surface: null });
            else if (isPlaceSlot(p.slot) && fitsSlot(v, p.slot)) spots.set(p.id, { ...SLOT_SPOT[p.slot] });
            else throw new RoomError(400, v.spot === 'wall' ? 'Это вешается на стену' : 'Сюда это не встанет');
          }
        }
        const seen = new Set<string>();
        for (const s of finalSlot.values()) {
          if (!s) continue;
          if (seen.has(s)) throw new RoomError(409, 'В одной ячейке может стоять только один предмет');
          seen.add(s);
        }
        // Отделка: сначала всех переставляемых — в кладовку, потом по местам
        // (обмен не спотыкается об уникальность ячейки посередине).
        const movedFinish = placements.filter((p) => finalSlot.has(p.id) && byId.get(p.id)?.slot !== finalSlot.get(p.id) && !spots.has(p.id));
        if (movedFinish.length > 0) {
          await tx.roomItem.updateMany({ where: { userId, id: { in: movedFinish.map((p) => p.id) } }, data: { slot: null } });
          for (const p of movedFinish) {
            const slot = finalSlot.get(p.id);
            if (slot) await tx.roomItem.update({ where: { id: p.id }, data: { slot } });
          }
        }
        for (const [id, sp] of spots) {
          await tx.roomItem.update({ where: { id }, data: { slot: null, ...sp } });
        }
        movedCount = movedFinish.length + spots.size;
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
