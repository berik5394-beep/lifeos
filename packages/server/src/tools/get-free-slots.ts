import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { findFreeSlots } from './_slots.js';

/**
 * SSOT Step 3b — read-only. Свободные окна в календаре юзера за
 * диапазон. Логика поиска — в чистом _slots.ts (без legacy switch).
 */
export const getFreeSlotsTool = defineTool({
  name: 'get_free_slots',
  description:
    'Свободные окна в календаре за период (рабочий день 09:00–20:00). ' +
    'Вызывай когда юзер просит «когда я свободен», «найди время для», ' +
    'перед предложением времени встречи/задачи.',
  category: 'calendar',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { from: 'dateFrom', to: 'dateTo', startDate: 'dateFrom', endDate: 'dateTo', start: 'dateFrom', end: 'dateTo' },
  schema: z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    minDurationMinutes: z.number().int().positive().max(1440).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['когда я свободен на этой неделе', 'найди 2 часа завтра'],
  handler: async (input, ctx) => {
    const dateFrom = new Date(input.dateFrom + 'T00:00:00Z');
    const dateTo = new Date(input.dateTo + 'T00:00:00Z');
    const events = await prisma.calendarEvent.findMany({
      where: { userId: ctx.userId, date: { gte: dateFrom, lte: dateTo } },
      select: { date: true, startTime: true, endTime: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 200,
    });
    const slots = findFreeSlots(
      events,
      dateFrom,
      dateTo,
      input.minDurationMinutes ?? 60,
    );
    return { count: slots.length, slots };
  },
});
