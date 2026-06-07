import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { normalizeHabit } from './_habit-match.js';

/**
 * Завести цель на ЭТОТ месяц из чата (аудит-фикс MISSING — раньше MonthlyGoal
 * вообще не было). monthStart = 1-е число месяца юзера (SSOT localMonthOnlyUTC —
 * ровно туда смотрят monthlyPlan-врезка, get_monthly_plan и детектор → цель
 * сразу видна мозгу). Дедуп по нормализованному тексту за месяц.
 * needsConfirm:false (обратимо, не деньги). Кросс-домен: живой monthlyPlan +
 * проактивный detectMonthlyGoalStall (роллап месяц↔неделя).
 */
export const createMonthlyGoalTool = defineTool({
  name: 'create_monthly_goal',
  description:
    'Записать цель на этот месяц («моя цель на июнь — закрыть 3 сделки», ' +
    '«в этом месяце хочу запустить продукт»). Я буду помнить её и напомню к ' +
    'концу месяца, если не закрыта.',
  category: 'task',
  aliases: { goal: 'goalText', text: 'goalText', title: 'goalText', goal_text: 'goalText' },
  schema: z.object({
    goalText: z.string().min(1).max(300),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['моя цель на месяц — закрыть 3 сделки', 'в этом месяце запустить продукт', 'цель месяца: нанять дизайнера'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const tz = await getUserTimezone(userId);
    const monthStart = localMonthOnlyUTC(tz);

    const month = await prisma.monthlyGoal.findMany({
      where: { userId, monthStart },
      select: { id: true, goalText: true },
    });
    // Дедуп: не плодим одинаковые цели месяца.
    const nt = normalizeHabit(input.goalText);
    const dup = month.find((g) => normalizeHabit(g.goalText) === nt);
    if (dup) {
      return {
        message: `Цель месяца «${dup.goalText}» уже записана.`,
        monthlyGoalId: dup.id,
        existed: true,
      };
    }

    const maxOrder = await prisma.monthlyGoal.aggregate({
      where: { userId, monthStart },
      _max: { order: true },
    });
    const goal = await prisma.monthlyGoal.create({
      data: {
        userId,
        monthStart,
        goalText: input.goalText,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return {
      message: `Цель месяца записана: «${goal.goalText}». Всего целей на этот месяц: ${month.length + 1}.`,
      monthlyGoalId: goal.id,
    };
  },
});
