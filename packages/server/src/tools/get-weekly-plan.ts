import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT 9A.5 — миграция agent-only read-tool get_weekly_plan в
 * реестр. Логика 1:1 (понедельник текущей недели → WeeklyGoal).
 * claude-agent свич — 9A.8.
 */

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

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
    const m = startOfDay(new Date());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // понедельник
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
