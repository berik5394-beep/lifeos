import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 5 — write-tool. Anti-dup логика 1:1 с legacy: если есть
 * событие с похожим названием в окне ±3 дня — ОБНОВЛЯЕМ, не плодим
 * дубль (фикс «3 встречи с Сериком»). Поведение байт-в-байт.
 */
export const createEventTool = defineTool({
  name: 'create_event',
  description:
    'Создать или перенести встречу/событие в календаре. Похожее ' +
    'событие в ±3 дня обновляется (не плодит дубль).',
  category: 'calendar',
  schema: z.object({
    title: z.string().min(1).max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    location: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['запиши встречу с Сериком завтра в 14:00'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const title = input.title;
    const date = new Date(input.date);
    const startTime = input.startTime ?? null;
    const endTime = input.endTime ?? null;

    const windowStart = new Date(date);
    windowStart.setDate(windowStart.getDate() - 3);
    const windowEnd = new Date(date);
    windowEnd.setDate(windowEnd.getDate() + 3);

    const existingEv = await prisma.calendarEvent.findFirst({
      where: {
        userId,
        title: { contains: title.slice(0, 40), mode: 'insensitive' },
        date: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { date: 'desc' },
    });

    if (existingEv) {
      const updated = await prisma.calendarEvent.update({
        where: { id: existingEv.id },
        data: {
          title,
          date,
          startTime,
          endTime,
          location: input.location ?? existingEv.location,
          description: input.description ?? existingEv.description,
        },
      });
      return {
        message: `Обновил встречу «${title}»: ${input.date}${
          startTime ? ' в ' + startTime : ''
        } (была одна запись — не плодил дубль)`,
        eventId: updated.id,
        updated: true,
      };
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId,
        title,
        date,
        startTime,
        endTime,
        location: input.location ?? null,
        description: input.description ?? null,
        source: 'voice',
      },
    });
    return {
      message: `Встреча "${title}" создана на ${input.date}${
        startTime ? ' в ' + startTime : ''
      }`,
      eventId: event.id,
      updated: false,
    };
  },
});
