import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

// ---------------------------------------------------------------------------
// Ограничения длин — защита от злонамеренных payload'ов (контакт-бомба).
// batch limit 2000: на среднем телефоне ~500-1500 контактов, запас 2000 хватит,
// но не даст загнать БД в колено одним запросом.
// ---------------------------------------------------------------------------
const contactItemSchema = z.object({
  phoneId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  phone: z.string().max(64).nullable(),
  email: z.string().max(256).nullable(),
  birthday: z.string().max(32).nullable(),
});

const syncSchema = z.object({
  contacts: z.array(contactItemSchema).max(2000),
});

const searchQuerySchema = z.object({
  q: z.string().min(1).max(128).optional(),
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Sync contacts from phone
  app.post(
    '/contacts/sync',
    { preHandler: validate(syncSchema) },
    async (request, reply) => {
      const userId = request.userId;
      const { contacts } = request.body as z.infer<typeof syncSchema>;

      // Отдельный try на каждый upsert: один битый контакт не должен
      // рушить всю синхронизацию. Логируем через request.log чтобы не
      // терять сигнал от Prisma (уникальные ключи, слишком длинные поля).
      let synced = 0;
      for (const c of contacts) {
        try {
          await prisma.contactCache.upsert({
            where: { userId_phoneId: { userId, phoneId: c.phoneId } },
            update: {
              name: c.name,
              phone: c.phone,
              email: c.email,
              birthday: c.birthday ? new Date(c.birthday) : null,
              lastSynced: new Date(),
            },
            create: {
              userId,
              phoneId: c.phoneId,
              name: c.name,
              phone: c.phone,
              email: c.email,
              birthday: c.birthday ? new Date(c.birthday) : null,
            },
          });
          synced++;
        } catch (err) {
          request.log.warn({ err, phoneId: c.phoneId }, 'contact sync: skip invalid');
        }
      }

      return reply.send({ synced, total: contacts.length });
    },
  );

  // Search contacts
  app.get(
    '/contacts/search',
    { preHandler: validate(searchQuerySchema, 'query') },
    async (request, reply) => {
      const userId = request.userId;
      const { q } = request.query as z.infer<typeof searchQuerySchema>;
      if (!q) return reply.send([]);

      const contacts = await prisma.contactCache.findMany({
        where: { userId, name: { contains: q, mode: 'insensitive' } },
        take: 10,
        select: { name: true, phone: true, email: true },
      });

      return reply.send(contacts);
    },
  );
}
