import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localWeekStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { normalizeHabit } from './_habit-match.js';

/**
 * Завести цель на ЭТУ неделю из чата (аудит-фикс MISSING — раньше WeeklyGoal
 * писался только app-роутом). weekStart = понедельник недели юзера (SSOT
 * localWeekStartUTC — ровно туда смотрит weeklyPlan-ридер в промпте → цель
 * сразу видна мозгу). Дедуп по нормализованному тексту за неделю.
 * needsConfirm:false (обратимо, не деньги). Кросс-домен: живой weeklyPlan +
 * проактивный detectWeeklyGoalStall (T3).
 */
export const createWeeklyGoalTool = defineTool({
  name: 'create_weekly_goal',
  description:
    'Записать цель на эту неделю («моя цель на неделю — закрыть отчёт», ' +
    '«на этой неделе хочу 3 тренировки»). Я буду помнить её и напомню к ' +
    'концу недели, если не закрыта.',
  category: 'task',
  aliases: { goal: 'goalText', text: 'goalText', title: 'goalText', goal_text: 'goalText' },
  schema: z.object({
    goalText: z.string().min(1).max(300),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['моя цель на неделю — закрыть отчёт', 'на этой неделе 3 тренировки', 'цель недели: дочитать книгу'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const tz = await getUserTimezone(userId);
    const weekStart = localWeekStartUTC(tz);

    const week = await prisma.weeklyGoal.findMany({
      where: { userId, weekStart },
      select: { id: true, goalText: true },
    });
    // Дедуп: не плодим одинаковые цели недели.
    const nt = normalizeHabit(input.goalText);
    const dup = week.find((g) => normalizeHabit(g.goalText) === nt);
    if (dup) {
      return {
        message: `Цель недели «${dup.goalText}» уже записана.`,
        weeklyGoalId: dup.id,
        existed: true,
      };
    }

    const maxOrder = await prisma.weeklyGoal.aggregate({
      where: { userId, weekStart },
      _max: { order: true },
    });
    const goal = await prisma.weeklyGoal.create({
      data: {
        userId,
        weekStart,
        goalText: input.goalText,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return {
      message: `Цель недели записана: «${goal.goalText}». Всего целей на эту неделю: ${week.length + 1}.`,
      weeklyGoalId: goal.id,
    };
  },
});
