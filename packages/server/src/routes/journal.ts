import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseMonth, invalidDateReply } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';

const journalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  energy: z.number().min(1).max(10).nullable().optional(),
  mood: z.number().min(1).max(10).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/journal/:date', async (request, reply) => {
    const { date } = request.params as { date: string };
    const parsed = parseDate(date);
    if (!parsed) return invalidDateReply(reply, 'date', 'YYYY-MM-DD');

    const entry = await prisma.journalEntry.findUnique({
      where: {
        userId_date: { userId: request.userId, date: parsed },
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

  app.get('/journal', async (request, reply) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const range = parseMonth(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');

      return prisma.journalEntry.findMany({
        where: {
          userId: request.userId,
          date: { gte: range.start, lt: range.end },
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

    const journalParts = [
      data.sleepHours != null ? `сон ${data.sleepHours}ч` : null,
      data.energy != null ? `энергия ${data.energy}` : null,
      data.mood != null ? `настроение ${data.mood}` : null,
    ].filter(Boolean);
    captureActivity(request.userId, {
      type: 'journal_logged',
      content:
        journalParts.length > 0
          ? `Дневник за ${data.date}: ${journalParts.join(', ')}`
          : `Дневник за ${data.date} обновлён`,
    });
    return reply.send(entry);
  });
}
