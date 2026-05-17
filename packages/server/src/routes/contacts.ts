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

      // D/E: раньше — upsert на КАЖДЫЙ контакт (до ~2000 round-trips
      // на синк). Теперь: 1 findMany существующих + 1 createMany для
      // новых + точечные update только реально изменившихся.
      // Резилентность сохранена: createMany(skipDuplicates) + fallback
      // по строкам, update в try/catch.
      const phoneIds = contacts.map((c) => c.phoneId);
      const existing = await prisma.contactCache.findMany({
        where: { userId, phoneId: { in: phoneIds } },
        select: { phoneId: true, name: true, phone: true, email: true, birthday: true },
      });
      const existingMap = new Map(existing.map((e) => [e.phoneId, e]));

      const toCreate: typeof contacts = [];
      const toUpdate: typeof contacts = [];
      const seen = new Set<string>();
      for (const c of contacts) {
        if (seen.has(c.phoneId)) continue; // дедуп внутри батча
        seen.add(c.phoneId);
        const ex = existingMap.get(c.phoneId);
        if (!ex) {
          toCreate.push(c);
        } else {
          const bd = c.birthday ? new Date(c.birthday).getTime() : null;
          const exBd = ex.birthday ? ex.birthday.getTime() : null;
          if (
            ex.name !== c.name ||
            ex.phone !== (c.phone ?? null) ||
            ex.email !== (c.email ?? null) ||
            exBd !== bd
          ) {
            toUpdate.push(c);
          }
        }
      }

      let synced = 0;
      if (toCreate.length > 0) {
        try {
          const res = await prisma.contactCache.createMany({
            data: toCreate.map((c) => ({
              userId,
              phoneId: c.phoneId,
              name: c.name,
              phone: c.phone,
              email: c.email,
              birthday: c.birthday ? new Date(c.birthday) : null,
            })),
            skipDuplicates: true,
          });
          synced += res.count;
        } catch (err) {
          // fallback по строкам — один битый контакт не валит весь батч
          request.log.warn({ err }, 'contact sync: batch create failed, row fallback');
          for (const c of toCreate) {
            try {
              await prisma.contactCache.create({
                data: {
                  userId,
                  phoneId: c.phoneId,
                  name: c.name,
                  phone: c.phone,
                  email: c.email,
                  birthday: c.birthday ? new Date(c.birthday) : null,
                },
              });
              synced++;
            } catch (e2) {
              request.log.warn({ err: e2, phoneId: c.phoneId }, 'contact sync: skip invalid');
            }
          }
        }
      }
      for (const c of toUpdate) {
        try {
          await prisma.contactCache.update({
            where: { userId_phoneId: { userId, phoneId: c.phoneId } },
            data: {
              name: c.name,
              phone: c.phone,
              email: c.email,
              birthday: c.birthday ? new Date(c.birthday) : null,
              lastSynced: new Date(),
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
