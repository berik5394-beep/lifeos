import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.6 — миграция agent-only read-tool get_trip в реестр.
 * Логика 1:1 (активные/ближайшие TravelPlan). claude-agent свич — 9A.8.
 */

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const getTripTool = defineTool({
  name: 'get_trip',
  description:
    'Активные/ближайшие поездки юзера (TravelPlan): куда, даты ' +
    'вылета/возврата, статус, ссылка брони. ОБЯЗАТЕЛЬНО вызывай на ' +
    '«когда у меня вылет», «куда я лечу», «что с поездкой», «бронь» ' +
    '— не отвечай «нет данных» не проверив.',
  category: 'travel',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['когда у меня вылет', 'куда я лечу', 'что с поездкой'],
  handler: async (_input, ctx) => {
    const today = startOfDay(new Date());
    const horizon = new Date(today.getTime() - 86_400_000); // вчера, чтобы свежие тоже
    const trips = await prisma.travelPlan.findMany({
      where: {
        userId: ctx.userId,
        status: { in: ['planning', 'booked', 'in_progress'] },
        dateFrom: { gte: horizon },
      },
      orderBy: { dateFrom: 'asc' },
      take: 3,
      select: {
        destination: true,
        dateFrom: true,
        dateTo: true,
        status: true,
        routes: true,
      },
    });
    if (trips.length === 0) {
      return { trips: [], note: 'Активных поездок в плане нет.' };
    }
    return {
      trips: trips.map((t) => ({
        destination: t.destination,
        departure: t.dateFrom.toISOString().slice(0, 10),
        return: t.dateTo ? t.dateTo.toISOString().slice(0, 10) : null,
        status: t.status,
        bookingUrl:
          t.routes && typeof t.routes === 'object' && 'bookingUrl' in t.routes
            ? (t.routes as { bookingUrl?: string }).bookingUrl
            : null,
      })),
    };
  },
});
