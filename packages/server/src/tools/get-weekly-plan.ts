import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localWeekStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';

/**
 * SSOT 9A.5 — agent-only read-tool get_weekly_plan в реестре. Понедельник
 * ТЕКУЩЕЙ недели → WeeklyGoal. weekStart в TZ ЮЗЕРА через localWeekStartUTC —
 * SSOT с create_weekly_goal + weeklyPlan-ридером (раньше был server-local
 * new Date()+setHours → для не-UTC юзера промах по понедельнику, цель не находилась).
 */

export const getWeeklyPlanTool = defineTool({
  name: 'get_weekly_plan',
  description:
    'Цели/план на ТЕКУЩУЮ неделю (WeeklyGoal): что выполнено, что ' +
    'осталось. Вызывай на «какие планы на неделю», «что у меня по ' +
    'неделе», «недельные цели».',
  category: 'task',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['какие планы на неделю', 'что у меня по неделе'],
  handler: async (_input, ctx) => {
    const m = localWeekStartUTC(await getUserTimezone(ctx.userId));
    const wg = await prisma.weeklyGoal.findMany({
      where: { userId: ctx.userId, weekStart: m },
      select: { goalText: true, completed: true },
      orderBy: { order: 'asc' },
      take: 12,
    });
    return {
      weekStart: m.toISOString().slice(0, 10),
      done: wg.filter((g) => g.completed).length,
      total: wg.length,
      goals: wg.map((g) => ({ text: g.goalText, done: g.completed })),
    };
  },
});
