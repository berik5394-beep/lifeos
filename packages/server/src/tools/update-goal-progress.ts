import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { isMoneyGoal, maybeGoalPaceLine } from '../services/goal-pace.js';

/** value → проценты 0..100. Абсолют (25 из 50 → 50) или уже-проценты (кламп). Чистая. */
export function pctFromValue(value: number, target: number, isPercent: boolean): number {
  const raw = isPercent ? value : target > 0 ? (value / target) * 100 : 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export const updateGoalProgressTool = defineTool({
  name: 'update_goal_progress',
  description:
    'Обнови прогресс ГОДОВОЙ ИЗМЕРИМОЙ цели по словам пользователя: ' +
    '«прочитал 25 книг», «сбросил 3 кг», «выучил 400 слов», «пробежал 100 км». ' +
    'goalQuery — про какую цель (часть текста цели), value — число ' +
    '(новый итог), valueIsPercent=true если это уже проценты.',
  category: 'task',
  aliases: { goal: 'goalQuery', query: 'goalQuery', amount: 'value', count: 'value' },
  schema: z.object({
    goalQuery: z.string().min(2).max(120).describe('часть текста годовой цели: «книг», «английск», «вес»'),
    value: z.number().min(0).max(1_000_000_000).describe('новый КУМУЛЯТИВНЫЙ итог: 25 (книг)'),
    valueIsPercent: z.boolean().optional().describe('true если value — это проценты 0..100'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['прочитал 25 книг', 'сбросил 3 кг', 'выучил 400 слов'],
  handler: async (input, ctx) => {
    const now = new Date();
    const tz = await getUserTimezone(ctx.userId);
    const year = Number(localDateStr(tz, now).split('-')[0]);

    const candidates = (
      await prisma.yearlyGoal.findMany({
        where: {
          userId: ctx.userId,
          year,
          target: { not: null },
          goalText: { contains: input.goalQuery, mode: 'insensitive' },
        },
        select: { id: true, goalText: true, area: true, target: true },
      })
    ).filter((g) => !isMoneyGoal(g.area, g.target));

    if (candidates.length === 0) {
      return {
        message: `Не нашёл измеримую годовую цель про «${input.goalQuery}». Скажи точнее или поставь цель.`,
      };
    }
    if (candidates.length > 1) {
      const list = candidates.map((g) => `«${g.goalText}»`).join(' / ');
      return { message: `Какую цель обновить: ${list}? Уточни.` };
    }

    const g = candidates[0];
    const target = g.target ?? 0;
    const pct = pctFromValue(input.value, target, input.valueIsPercent === true);
    await prisma.yearlyGoal.update({ where: { id: g.id }, data: { progress: pct } });

    captureActivity(ctx.userId, {
      type: 'goal_progress_updated',
      content: `Прогресс цели «${g.goalText}»: ${input.value} из ${target} (${pct}%)`,
    });

    const base = `Отметил по «${g.goalText}»: ${input.value} из ${target} (${pct}%).`;
    const pace = await maybeGoalPaceLine(ctx.userId, g.id, now);
    return { message: pace ? `${base}\n\n${pace}` : base };
  },
});
