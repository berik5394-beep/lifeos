import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localDateStr, addCivilDays, dateOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';

/**
 * Привычки: что сделано сегодня и за 7 дней. Раньше у мозга не было
 * инструмента прочитать привычки — на «как у меня с привычками?» он
 * опирался только на контекст сегодняшнего дня.
 * HabitLog.date — календарная дата юзера (convA, как complete_habit).
 */
export const getHabitsTool = defineTool({
  name: 'get_habits',
  description:
    'Привычки юзера: какие активны, что отмечено сегодня и сколько раз за последние 7 дней. ' +
    'Вызывай на «как у меня с привычками», «что я сегодня не отметил», «сколько раз тренировался на неделе».',
  category: 'habit',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['как у меня с привычками', 'что я сегодня не отметил'],
  handler: async (_input, ctx) => {
    const tz = await getUserTimezone(ctx.userId);
    const today = localDateStr(tz);
    const from = addCivilDays(today, -6);
    const [habits, logs] = await Promise.all([
      prisma.habit.findMany({
        where: { userId: ctx.userId, active: true },
        select: { id: true, name: true, category: true },
        orderBy: { order: 'asc' },
        take: 40,
      }),
      prisma.habitLog.findMany({
        where: { userId: ctx.userId, completed: true, date: { gte: dateOnlyUTC(from), lte: dateOnlyUTC(today) } },
        select: { habitId: true, date: true },
      }),
    ]);
    const todayKey = dateOnlyUTC(today).getTime();
    return {
      today,
      habits: habits.map((h) => {
        const mine = logs.filter((l) => l.habitId === h.id);
        return {
          name: h.name,
          category: h.category,
          doneToday: mine.some((l) => l.date.getTime() === todayKey),
          doneLast7Days: mine.length,
        };
      }),
    };
  },
});
