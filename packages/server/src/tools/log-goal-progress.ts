import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { localDateStr } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { captureActivity } from '../services/tool-activity-summary.js';

/**
 * Аудит-фикс P1 HOLLOW: духовная/нечисловая цель (target=null) — update_goal_progress
 * её НЕ находит (фильтр target:{not:null}), а detectGoalNoProgress нудит «14 дней без
 * прогресса». Не было способа ответить на укор → мёртвое обещание.
 *
 * log_goal_progress = недостающий ПИСАТЕЛЬ, оживляет существующий ЧИТАТЕЛЬ
 * detectGoalNoProgress (как set_budget ↔ budget-warning). Качественный чек-ин:
 * (1) запись progress (даже тем же значением) форсит @updatedAt → нуда сбрасывается;
 * (2) заметка → captureActivity → единый мозг видит духовный прогресс.
 * needsConfirm:false — не деньги, обратимо. Без флага (новый инструмент всем).
 */
export const logGoalProgressTool = defineTool({
  name: 'log_goal_progress',
  description:
    'Отметить ПРОГРЕСС по годовой НЕЧИСЛОВОЙ цели словами: «по цели "духовный ' +
    'рост" — медитировал всю неделю», «продвинулся по цели читать больше — осилил ' +
    'главу». goalQuery — часть текста цели; note — что именно сделал; percent — ' +
    'опц. оценка прогресса 0..100. Для ИЗМЕРИМЫХ целей (книги/кг/деньги) используй ' +
    'update_goal_progress.',
  category: 'task',
  aliases: { goal: 'goalQuery', query: 'goalQuery', text: 'note', comment: 'note', progress: 'percent' },
  schema: z.object({
    goalQuery: z.string().min(2).max(120).describe('часть текста годовой цели: «духовн», «английск»'),
    note: z.string().min(2).max(500).describe('что именно сделал по цели'),
    percent: z.coerce.number().min(0).max(100).optional().describe('опц. оценка прогресса 0..100'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['по цели духовный рост медитировал всю неделю', 'продвинулся по цели читать больше'],
  handler: async (input, ctx) => {
    const tz = await getUserTimezone(ctx.userId);
    const year = Number(localDateStr(tz, new Date()).split('-')[0]);

    const candidates = await prisma.yearlyGoal.findMany({
      where: {
        userId: ctx.userId,
        year,
        goalText: { contains: input.goalQuery, mode: 'insensitive' },
      },
      select: { id: true, goalText: true, progress: true },
    });

    if (candidates.length === 0) {
      return { message: `Не нашёл годовую цель про «${input.goalQuery}». Скажи точнее или поставь цель.` };
    }
    if (candidates.length > 1) {
      const list = candidates.map((g) => `«${g.goalText}»`).join(' / ');
      return { message: `По какой цели отметить прогресс: ${list}? Уточни.` };
    }

    const g = candidates[0];
    const pct = input.percent != null ? Math.min(100, Math.max(0, Math.round(input.percent))) : null;
    // Запись (даже тем же progress) форсит @updatedAt → detectGoalNoProgress сбрасывает нуду.
    await prisma.yearlyGoal.update({
      where: { id: g.id },
      data: { progress: pct ?? g.progress },
    });

    captureActivity(ctx.userId, {
      type: 'goal_progress_logged',
      content: `Прогресс по «${g.goalText}»: ${input.note}${pct != null ? ` (${pct}%)` : ''}`,
    });

    const tail = pct != null ? ` Прогресс ${pct}%.` : '';
    return { message: `Записал прогресс по «${g.goalText}»: ${input.note}.${tail} Так держать — маленькие шаги тоже считаются.` };
  },
});
