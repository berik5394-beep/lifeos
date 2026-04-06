import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const journalSchema = z.object({
  date: z.string(),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  energy: z.number().min(1).max(10).nullable().optional(),
  mood: z.number().min(1).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/journal/:date', async (request) => {
    const { date } = request.params as { date: string };

    const entry = await prisma.journalEntry.findUnique({
      where: {
        userId_date: { userId: request.userId, date: new Date(date) },
      },
    });

    return entry ?? {
      date,
      sleepHours: null,
      energy: null,
      mood: null,
      notes: null,
    };
  });

  app.get('/journal', async (request) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 1);

      return prisma.journalEntry.findMany({
        where: {
          userId: request.userId,
          date: { gte: start, lt: end },
        },
        orderBy: { date: 'desc' },
      });
    }

    return prisma.journalEntry.findMany({
      where: { userId: request.userId },
      orderBy: { date: 'desc' },
      take: 30,
    });
  });

  app.post('/journal', {
    preHandler: validate(journalSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof journalSchema>;
    const dateObj = new Date(data.date);

    const entry = await prisma.journalEntry.upsert({
      where: {
        userId_date: { userId: request.userId, date: dateObj },
      },
      create: {
        userId: request.userId,
        date: dateObj,
        sleepHours: data.sleepHours ?? null,
        energy: data.energy ?? null,
        mood: data.mood ?? null,
        notes: data.notes ?? null,
      },
      update: {
        sleepHours: data.sleepHours ?? undefined,
        energy: data.energy ?? undefined,
        mood: data.mood ?? undefined,
        notes: data.notes ?? undefined,
      },
    });

    return reply.send(entry);
  });
}
