import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseMonth as validateMonthRange, invalidDateReply } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { proposeReschedule } from '../services/reschedule.js';
import { withIdempotency } from '../lib/idempotency.js';
import { screenConflictText } from '../services/schedule-conflict/index.js';
import { googleNote, pushToGoogle, shiftTimes } from '../services/event-change.js';

const createEventSchema = z.object({
  title: z.string().min(1, 'Название обязательно').max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  startTime: z.string().max(8).optional(),
  endTime: z.string().max(8).optional(),
  location: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  reminder: z.number().int().optional(),
  source: z.string().max(64).optional(),
});

const updateEventSchema = createEventSchema.partial();

function getWeekRange(date: Date) {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(date);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
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

  app.get('/events', async (request, reply) => {
    const { date, week, month } = request.query as {
      date?: string;
      week?: string;
      month?: string;
    };

    let where: Record<string, unknown> = { userId: request.userId };

    if (date) {
      const parsed = parseDate(date);
      if (!parsed) return invalidDateReply(reply, 'date', 'YYYY-MM-DD');
      where.date = parsed;
    } else if (week) {
      const weekDate = parseDate(week);
      if (!weekDate) return invalidDateReply(reply, 'week', 'YYYY-MM-DD');
      const { start, end } = getWeekRange(weekDate);
      where.date = { gte: start, lt: end };
    } else if (month) {
      const range = validateMonthRange(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
      where.date = { gte: range.start, lt: range.end };
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
    // Idempotency-Key: повтор офлайн-очереди не создаст встречу второй раз.
    async (request, reply) => withIdempotency(request, reply, async () => {
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

      captureActivity(request.userId, {
        type: 'event_created',
        content: `Встреча «${event.title}» ${data.date}${data.startTime ? ' в ' + data.startTime : ''}`,
      });
      // Перегруз дня: встреча съела время дня → робот предлагает сдвинуть задачи.
      // Импорт календаря телефона шлёт пачку встреч (source 'imported') — не
      // спамим чат предложениями на каждую; только ручное добавление.
      const proposal =
        event.startTime && event.endTime && event.source === 'manual'
          ? await proposeReschedule(request.userId, data.date, null, new Date(), { fromCard: true })
          : null;
      // Облачко робота: с чем пересекается (встречи И задачи со временем).
      // Импорт пачкой — не шумим, как и с proposal.
      const conflictWarning =
        event.source === 'manual'
          ? await screenConflictText(
              request.userId,
              event.date,
              { kind: 'event', title: event.title, start: event.startTime, end: event.endTime },
              { eventId: event.id },
            )
          : null;
      return {
        status: 201,
        body: {
          ...event,
          ...(conflicts.length > 0 ? { conflicts } : {}),
          ...(conflictWarning ? { conflictWarning } : {}),
          ...(proposal ? { proposal: { text: proposal.text, staged: proposal.staged } } : {}),
        },
      };
    }),
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
      // Новое начало без конца — длительность сохраняем (14:00–15:00 → 16:00–17:00);
      // раньше конец оставался старым и мог стать раньше начала.
      const times = shiftTimes(existing, { startTime: data.startTime, endTime: data.endTime });
      const startTime = times.startTime;
      const endTime = times.endTime;

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
          ...(data.startTime !== undefined || data.endTime !== undefined ? { startTime, endTime } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.reminder !== undefined ? { reminder: data.reminder } : {}),
          ...(data.source !== undefined ? { source: data.source } : {}),
        },
      });

      captureActivity(request.userId, {
        type: 'event_updated',
        content: `Изменил встречу «${updated.title}»`,
      });
      // Перегруз дня: встречу перенесли/удлинили → проверяем её день.
      const timeChanged =
        updated.date.getTime() !== existing.date.getTime() ||
        updated.startTime !== existing.startTime ||
        updated.endTime !== existing.endTime;
      const proposal =
        timeChanged && updated.startTime && updated.endTime && updated.source !== 'imported'
          ? await proposeReschedule(request.userId, updated.date.toISOString().slice(0, 10), null, new Date(), { fromCard: true })
          : null;
      // Встреча из Google (или уже выгруженная): правку — и туда, иначе следующая
      // синхронизация перезапишет её старыми данными.
      const contentChanged =
        timeChanged || updated.title !== existing.title || updated.location !== existing.location || updated.description !== existing.description;
      const google = contentChanged ? await pushToGoogle(request.userId, updated, 'patch') : 'none';
      // Наложение по новому времени (встречи И задачи) — облачком, как при создании.
      const overlap = timeChanged
        ? await screenConflictText(
            request.userId,
            updated.date,
            { kind: 'event', title: updated.title, start: updated.startTime, end: updated.endTime },
            { eventId: updated.id },
          )
        : null;
      const conflictWarning = [overlap, googleNote(google, 'patch').trim()].filter(Boolean).join(' ') || null;
      return reply.send({
        ...updated,
        ...(conflicts.length > 0 ? { conflicts } : {}),
        ...(proposal ? { proposal: { text: proposal.text, staged: proposal.staged } } : {}),
        ...(conflictWarning ? { conflictWarning } : {}),
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

    // Из Google тоже — иначе синхронизация вернёт удалённую встречу.
    const google = await pushToGoogle(request.userId, event, 'delete');
    await prisma.calendarEvent.delete({ where: { id } });
    captureActivity(request.userId, {
      type: 'event_deleted',
      content: `Убрал встречу «${event.title}»`,
    });
    const note = googleNote(google, 'delete').trim();
    return reply.send({ success: true, ...(note ? { warning: note } : {}) });
  });
}
