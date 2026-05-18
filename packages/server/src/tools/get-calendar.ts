import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.2 — миграция agent-only read-tool get_calendar в реестр.
 * Логика 1:1 с прежним runLocalTool('get_calendar') (паритет).
 * claude-agent свич на anthropicSchemas — 9A.8.
 */
export const getCalendarTool = defineTool({
  name: 'get_calendar',
  description:
    'События календаря юзера в диапазоне дат. Для проверки ' +
    'занятости/конфликтов перед планированием.',
  category: 'calendar',
  schema: z.object({
    from: z.string().max(20),
    to: z.string().max(20),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['покажи мои встречи на неделе', 'что у меня в календаре'],
  handler: async (input, ctx) => {
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: ctx.userId,
        date: {
          gte: new Date(String(input.from) + 'T00:00:00Z'),
          lte: new Date(String(input.to) + 'T00:00:00Z'),
        },
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
