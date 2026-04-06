import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const createEventSchema = z.object({
  title: z.string().min(1, 'Название обязательно'),
  date: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  reminder: z.number().int().optional(),
  source: z.string().optional(),
});

const updateEventSchema = createEventSchema.partial();

function getWeekRange(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(date);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function getMonthRange(monthStr: string) {
  const [year, m] = monthStr.split('-').map(Number);
  const start = new Date(year, m - 1, 1);
  const end = new Date(year, m, 1);
  return { start, end };
}

function timesOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}

async function findConflicts(
  userId: string,
  date: Date,
  startTime: string | undefined | null,
  endTime: string | undefined | null,
  excludeId?: string,
) {
  if (!startTime || !endTime) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      date,
      startTime: { not: null },
      endTime: { not: null },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });

  return events.filter((e) =>
    timesOverlap(startTime, endTime, e.startTime, e.endTime),
  );
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- List events ---

  app.get('/events', async (request) => {
    const { date, week, month } = request.query as {
      date?: string;
      week?: string;
      month?: string;
    };

    let where: Record<string, unknown> = { userId: request.userId };

    if (date) {
      where.date = new Date(date);
    } else if (week) {
      const { start, end } = getWeekRange(week);
      where.date = { gte: start, lt: end };
    } else if (month) {
      const { start, end } = getMonthRange(month);
      where.date = { gte: start, lt: end };
    }

    return prisma.calendarEvent.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  });

  // --- Upcoming events (next 24h) ---

  app.get('/events/upcoming', async (request) => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayDate = new Date(now.toISOString().split('T')[0]);
    const tomorrowDate = new Date(tomorrow.toISOString().split('T')[0]);

    return prisma.calendarEvent.findMany({
      where: {
        userId: request.userId,
        date: { gte: todayDate, lte: tomorrowDate },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  });

  // --- Create event ---

  app.post(
    '/events',
    { preHandler: validate(createEventSchema) },
    async (request, reply) => {
      const data = request.body as z.infer<typeof createEventSchema>;
      const eventDate = new Date(data.date);

      const conflicts = await findConflicts(
        request.userId,
        eventDate,
        data.startTime,
        data.endTime,
      );

      const event = await prisma.calendarEvent.create({
        data: {
          title: data.title,
          date: eventDate,
          startTime: data.startTime ?? null,
          endTime: data.endTime ?? null,
          location: data.location ?? null,
          description: data.description ?? null,
          reminder: data.reminder ?? 30,
          source: data.source ?? 'manual',
          userId: request.userId,
        },
      });

      return reply.status(201).send({
        ...event,
        ...(conflicts.length > 0 ? { conflicts } : {}),
      });
    },
  );

  // --- Update event ---

  app.put(
    '/events/:id',
    { preHandler: validate(updateEventSchema) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof updateEventSchema>;

      const existing = await prisma.calendarEvent.findFirst({
        where: { id, userId: request.userId },
      });
      if (!existing) {
        return reply.status(404).send({ message: 'Событие не найдено' });
      }

      const eventDate = data.date ? new Date(data.date) : existing.date;
      const startTime =
        data.startTime !== undefined ? data.startTime : existing.startTime;
      const endTime =
        data.endTime !== undefined ? data.endTime : existing.endTime;

      const conflicts = await findConflicts(
        request.userId,
        eventDate,
        startTime,
        endTime,
        id,
      );

      const updated = await prisma.calendarEvent.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.date !== undefined ? { date: eventDate } : {}),
          ...(data.startTime !== undefined
            ? { startTime: data.startTime }
            : {}),
          ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.reminder !== undefined ? { reminder: data.reminder } : {}),
          ...(data.source !== undefined ? { source: data.source } : {}),
        },
      });

      return reply.send({
        ...updated,
        ...(conflicts.length > 0 ? { conflicts } : {}),
      });
    },
  );

  // --- Delete event ---

  app.delete('/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const event = await prisma.calendarEvent.findFirst({
      where: { id, userId: request.userId },
    });
    if (!event) {
      return reply.status(404).send({ message: 'Событие не найдено' });
    }

    await prisma.calendarEvent.delete({ where: { id } });
    return reply.send({ success: true });
  });
}
