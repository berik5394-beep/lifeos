import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const syncSchema = z.object({
  events: z.array(z.object({
    externalId: z.string(),
    title: z.string(),
    date: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    location: z.string().nullable(),
    description: z.string().nullable(),
  })),
});

export async function calendarSyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Sync calendar events from device
  app.post('/calendar/sync', async (request, reply) => {
    const userId = request.userId;
    const { events } = syncSchema.parse(request.body);

    let synced = 0;
    for (const e of events) {
      try {
        // Check if event already exists by title+date to avoid duplicates
        const existing = await prisma.calendarEvent.findFirst({
          where: { userId, title: e.title, date: new Date(e.date) },
        });
        if (!existing) {
          await prisma.calendarEvent.create({
            data: {
              userId,
              title: e.title,
              date: new Date(e.date),
              startTime: e.startTime,
              endTime: e.endTime,
              location: e.location,
              description: e.description,
              source: 'imported',
            },
          });
          synced++;
        }
      } catch { /* skip invalid */ }
    }

    return reply.send({ synced, total: events.length });
  });

  // Get free slots
  app.get('/calendar/free-slots', async (request, reply) => {
    const userId = request.userId;
    const { from, to } = request.query as { from?: string; to?: string };
    if (!from || !to) return reply.status(400).send({ message: 'from and to required' });

    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: { gte: new Date(from), lte: new Date(to) } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    return reply.send(events);
  });
}
