import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Схемы. isoDate — защита от мусора вроде "tomorrow" или SQL-инъекций в строке,
// уходящих в new Date(). HH:MM ограничение выловит кейсы с битыми таймзонами.
// max(1000) батч: больше — и уже нужно постраничное API, а не полный sync.
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата должна быть в формате YYYY-MM-DD');
const isoTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время должно быть в формате HH:MM');

const eventItemSchema = z.object({
  externalId: z.string().min(1).max(256),
  title: z.string().min(1).max(512),
  date: isoDate,
  startTime: isoTime.nullable(),
  endTime: isoTime.nullable(),
  location: z.string().max(512).nullable(),
  description: z.string().max(4096).nullable(),
});

const syncSchema = z.object({
  events: z.array(eventItemSchema).max(1000),
});

const freeSlotsQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});

export async function calendarSyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Sync calendar events from device
  app.post(
    '/calendar/sync',
    { preHandler: validate(syncSchema) },
    async (request, reply) => {
      const userId = request.userId;
      const { events } = request.body as z.infer<typeof syncSchema>;

      // D/E: раньше findFirst+create на КАЖДОЕ событие (2N запросов).
      // Теперь: 1 findMany существующих в окне дат + 1 createMany для
      // новых (дедуп по title+date, как и было). Резилентность —
      // createMany(skipDuplicates) + fallback по строкам.
      let synced = 0;
      if (events.length > 0) {
        const dates = events.map((e) => new Date(e.date).getTime());
        const minD = new Date(Math.min(...dates));
        const maxD = new Date(Math.max(...dates));
        const existing = await prisma.calendarEvent.findMany({
          where: { userId, date: { gte: minD, lte: maxD } },
          select: { title: true, date: true },
        });
        const key = (t: string, d: Date) => `${t}|${d.toISOString().slice(0, 10)}`;
        const existSet = new Set(existing.map((e) => key(e.title, e.date)));

        const toCreate: typeof events = [];
        const batchSeen = new Set<string>();
        for (const e of events) {
          const k = key(e.title, new Date(e.date));
          if (existSet.has(k) || batchSeen.has(k)) continue;
          batchSeen.add(k);
          toCreate.push(e);
        }

        if (toCreate.length > 0) {
          const rows = toCreate.map((e) => ({
            userId,
            title: e.title,
            date: new Date(e.date),
            startTime: e.startTime,
            endTime: e.endTime,
            location: e.location,
            description: e.description,
            source: 'imported',
          }));
          try {
            const res = await prisma.calendarEvent.createMany({ data: rows });
            synced += res.count;
          } catch (err) {
            request.log.warn({ err }, 'calendar sync: batch failed, row fallback');
            for (const r of rows) {
              try {
                await prisma.calendarEvent.create({ data: r });
                synced++;
              } catch (e2) {
                request.log.warn({ err: e2, title: r.title }, 'calendar sync: skip invalid');
              }
            }
          }
        }
      }

      return reply.send({ synced, total: events.length });
    },
  );

  // Get free slots
  app.get(
    '/calendar/free-slots',
    { preHandler: validate(freeSlotsQuerySchema, 'query') },
    async (request, reply) => {
      const userId = request.userId;
      const { from, to } = request.query as z.infer<typeof freeSlotsQuerySchema>;

      // Дополнительный sanity-check: диапазон не должен быть перевёрнут и не
      // должен быть больше года (защита от случайного DoS на выборку).
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (toDate < fromDate) {
        throw new ValidationError('Параметр "to" должен быть позже "from"', {
          fields: ['from', 'to'],
        });
      }
      const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
      if (toDate.getTime() - fromDate.getTime() > maxSpanMs) {
        throw new ValidationError('Диапазон не может превышать 1 год', {
          fields: ['from', 'to'],
        });
      }

      const events = await prisma.calendarEvent.findMany({
        where: { userId, date: { gte: fromDate, lte: toDate } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      });

      return reply.send(events);
    },
  );
}
