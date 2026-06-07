import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';

/**
 * Цели/план на ТЕКУЩИЙ месяц (MonthlyGoal): что выполнено, что осталось.
 * monthStart в TZ ЮЗЕРА через localMonthOnlyUTC — SSOT с create_monthly_goal +
 * monthlyPlan-врезкой + детектором.
 */
export const getMonthlyPlanTool = defineTool({
  name: 'get_monthly_plan',
  description:
    'Цели/план на ТЕКУЩИЙ месяц (MonthlyGoal): что выполнено, что осталось. ' +
    'Вызывай на «какие планы на месяц», «что у меня по месяцу», «месячные цели».',
  category: 'task',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['какие планы на месяц', 'что у меня по месяцу', 'месячные цели'],
  handler: async (_input, ctx) => {
    const m = localMonthOnlyUTC(await getUserTimezone(ctx.userId));
    const mg = await prisma.monthlyGoal.findMany({
      where: { userId: ctx.userId, monthStart: m },
      select: { goalText: true, completed: true },
      orderBy: { order: 'asc' },
      take: 12,
    });
    return {
      monthStart: m.toISOString().slice(0, 10),
      done: mg.filter((g) => g.completed).length,
      total: mg.length,
      goals: mg.map((g) => ({ text: g.goalText, done: g.completed })),
    };
  },
});
