import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROOM_ITEM_KEYS, ROOM_MAX_ITEMS } from '../services/room-context.js';

/**
 * Робот-эпик, Часть 4: комната робота. Расстановка мебели хранится на сервере
 * (не теряется при переустановке) и видна мозгу (room-context в enrichment).
 */
const putRoomSchema = z.object({
  items: z
    .array(
      z.object({
        itemKey: z.enum(ROOM_ITEM_KEYS),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .max(ROOM_MAX_ITEMS, `В комнате помещается не больше ${ROOM_MAX_ITEMS} предметов`),
});

const SELECT = { id: true, itemKey: true, x: true, y: true } as const;

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /room — текущая расстановка
  app.get('/room', async (request) => {
    const items = await prisma.roomItem.findMany({
      where: { userId: request.userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: SELECT,
    });
    return { items };
  });

  // PUT /room — заменить расстановку целиком (одна транзакция)
  app.put('/room', { preHandler: validate(putRoomSchema) }, async (request) => {
    const { items } = request.body as z.infer<typeof putRoomSchema>;
    const userId = request.userId;
    const saved = await prisma.$transaction(async (tx) => {
      // Пер-юзерный замок: два одновременных PUT (медленная сеть + новое
      // движение) иначе оба удаляют «старое» и оба вставляют — в БД остаётся
      // объединение обоих наборов (дубли мебели). С замком второй ждёт первого.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'room:' + userId}))`;
      await tx.roomItem.deleteMany({ where: { userId } });
      if (items.length > 0) {
        await tx.roomItem.createMany({ data: items.map((i) => ({ ...i, userId })) });
      }
      return tx.roomItem.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: SELECT });
    });
    return { items: saved };
  });
}
