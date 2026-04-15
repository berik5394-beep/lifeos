import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const syncSchema = z.object({
  contacts: z.array(z.object({
    phoneId: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    birthday: z.string().nullable(),
  })),
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Sync contacts from phone
  app.post('/contacts/sync', async (request, reply) => {
    const userId = request.userId;
    const { contacts } = syncSchema.parse(request.body);

    let synced = 0;
    for (const c of contacts) {
      try {
        await prisma.contactCache.upsert({
          where: { userId_phoneId: { userId, phoneId: c.phoneId } },
          update: { name: c.name, phone: c.phone, email: c.email, birthday: c.birthday ? new Date(c.birthday) : null, lastSynced: new Date() },
          create: { userId, phoneId: c.phoneId, name: c.name, phone: c.phone, email: c.email, birthday: c.birthday ? new Date(c.birthday) : null },
        });
        synced++;
      } catch { /* skip invalid */ }
    }

    return reply.send({ synced, total: contacts.length });
  });

  // Search contacts
  app.get('/contacts/search', async (request, reply) => {
    const userId = request.userId;
    const { q } = request.query as { q?: string };
    if (!q) return reply.send([]);

    const contacts = await prisma.contactCache.findMany({
      where: { userId, name: { contains: q, mode: 'insensitive' } },
      take: 10,
      select: { name: true, phone: true, email: true },
    });

    return reply.send(contacts);
  });
}
