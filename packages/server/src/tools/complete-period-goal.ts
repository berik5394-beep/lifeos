import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC, localWeekStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { matchHabit, type HabitRef } from './_habit-match.js';

/**
 * Отметить цель НЕДЕЛИ или МЕСЯЦА выполненной (или вернуть). Раньше робот
 * спрашивал «Успеем?» / «добьём?» (weekly/monthly_goal_stall), а на «уже
 * сделал» отметить было нечем — только экран. Обратимо (undo: true).
 */
export const completePeriodGoalTool = defineTool({
  name: 'complete_period_goal',
  description:
    'Отметить цель недели или месяца выполненной («цель недели закрыл», ' +
    '«цель на месяц сделал»), undo: true — вернуть в открытые. period — ' +
    'week или month, если непонятно. Годовая цель — log_goal_progress, не я.',
  category: 'task',
  aliases: { goalText: 'goal', text: 'goal', name: 'goal', title: 'goal', reopen: 'undo' },
  schema: z.object({
    goal: z.string().min(1).max(300),
    period: z.enum(['week', 'month']).optional(),
    undo: z.boolean().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['цель недели закрыл', 'цель месяца сделал'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const tz = await getUserTimezone(userId);
    const done = !input.undo;
    const [week, month] = await Promise.all([
      input.period === 'month'
        ? Promise.resolve([])
        : prisma.weeklyGoal.findMany({ where: { userId, weekStart: localWeekStartUTC(tz) }, select: { id: true, goalText: true, completed: true } }),
      input.period === 'week'
        ? Promise.resolve([])
        : prisma.monthlyGoal.findMany({ where: { userId, monthStart: localMonthOnlyUTC(tz) }, select: { id: true, goalText: true, completed: true } }),
    ]);
    const refs: Array<HabitRef & { kind: 'week' | 'month' }> = [
      ...week.map((g) => ({ id: g.id, name: g.goalText, kind: 'week' as const })),
      ...month.map((g) => ({ id: g.id, name: g.goalText, kind: 'month' as const })),
    ];
    const hit = matchHabit(input.goal, refs);
    if (!hit) {
      const list = refs.map((r) => `«${r.name}»`).join(', ');
      return { message: list ? `Не нашёл цель «${input.goal}». Сейчас: ${list}. Какую?` : 'Целей на эту неделю и месяц пока нет.', needsInput: true };
    }
    const kind = refs.find((r) => r.id === hit.id)!.kind;
    const label = kind === 'week' ? 'недели' : 'месяца';
    const r =
      kind === 'week'
        ? await prisma.weeklyGoal.updateMany({ where: { id: hit.id, userId }, data: { completed: done } })
        : await prisma.monthlyGoal.updateMany({ where: { id: hit.id, userId }, data: { completed: done } });
    if (r.count === 0) return { message: `Не нашёл цель «${input.goal}».`, needsInput: true };
    const pool = kind === 'week' ? week : month;
    const open = pool.filter((g) => (g.id === hit.id ? !done : !g.completed)).length;
    const tail = done ? (open === 0 ? ' Все цели закрыты — красавчик!' : ` Осталось ${open} из ${pool.length}.`) : '';
    return {
      message: done ? `Отметил цель ${label} «${hit.name}» выполненной.${tail}` : `Вернул цель ${label} «${hit.name}» в открытые.`,
      goalId: hit.id,
    };
  },
});
