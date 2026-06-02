import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.2 — миграция agent-only read-tool get_calendar в реестр.
 * Логика 1:1 с прежним runLocalTool('get_calendar') (паритет).
 * claude-agent свич на anthropicSchemas — 9A.8.
 */
export const getCalendarTool = defineTool({
  name: 'get_calendar',
  description:
    'События календаря юзера в диапазоне дат (что уже занято). ' +
    'Для проверки занятости/конфликтов перед планированием. Для ' +
    'поиска СВОБОДНЫХ окон — используй get_free_slots, не считай в уме.',
  category: 'calendar',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { dateFrom: 'from', fromDate: 'from', startDate: 'from', start: 'from', dateTo: 'to', toDate: 'to', endDate: 'to', end: 'to' },
  schema: z.object({
    // L99 R9 #5 fix: regex YYYY-MM-DD (раньше z.string().max(20)
    // принимал "yesterday" → new Date("yesterday") = Invalid Date →
    // Prisma throws «invalid value». Consistency с create_event/
    // get_free_slots/create_task/search_flights — все enforce regex).
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .describe('дата начала диапазона YYYY-MM-DD'),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .describe('дата конца диапазона YYYY-MM-DD'),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['покажи мои встречи на неделе', 'что у меня в календаре'],
  handler: async (input, ctx) => {
    // R9 TZ-aware: date boundaries (consistency с write side).
    const tz = await getUserTimezone(ctx.userId);
    // Mid-day UTC trick для надёжного попадания в нужный локальный
    // день любой tz, затем UTC instant начала этого дня в tz юзера.
    const gte = localDayStartUTC(tz, new Date(input.from + 'T12:00:00Z'));
    const lte = localDayStartUTC(tz, new Date(input.to + 'T12:00:00Z'));
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: ctx.userId,
        date: { gte, lte },
      },
      select: {
        title: true,
        date: true,
        startTime: true,
        endTime: true,
        location: true,
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 100,
    });
    return events.map((e) => ({
      ...e,
      date: e.date.toISOString().slice(0, 10),
    }));
  },
});
