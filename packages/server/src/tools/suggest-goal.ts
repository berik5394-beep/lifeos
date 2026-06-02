import { z } from 'zod';
import { defineTool } from './_types.js';
import { parseGoalDeadline } from '../services/goal-deadline.js';
import { setPendingAction } from '../services/pending-actions.js';

/**
 * v2.0 Week 5 / 2026-06 — ПРЕДЛОЖИТЬ оформить годовую цель.
 *
 * Друг СПРАШИВАЕТ перед записью: этот инструмент НЕ пишет цель, а ставит
 * pending('commit_goal') + задаёт вопрос. Реальная запись — на «да»
 * (runConfirmedAction → commitGoal). Тот же паттерн, что у денег: предложил
 * → подтвердил → записал. Бот читает между строк и предлагает зафиксировать.
 *
 * needsConfirm:FALSE — намеренно: инструмент сам по себе НЕ мутирует данные
 * (только ставит предложение), поэтому он агент-вызываемый (agentToolSchemas
 * фильтрует needsConfirm). Если бы он был needsConfirm:true — был бы исключён
 * из набора агента и недостижим из чата (корень того, что цель не
 * предлагалась/не сохранялась, SMOKE). Деньги по-прежнему needsConfirm:true.
 *
 * Захват измеримой цели: передавай `target` (число) + `targetDate` (срок,
 * относительный резолвим) — их пишет commitGoal, и читает коуч по
 * накоплениям. `goalId` — если правим существующую цель.
 */
export const suggestGoalTool = defineTool({
  name: 'suggest_goal',
  description:
    'ПРЕДЛОЖИТЬ пользователю оформить годовую цель (бот спросит, запишет ' +
    'на «да»), в т.ч. ИЗМЕРИМУЮ (сумма+срок): «накопить 100000 к концу ' +
    'месяца», «прочитать 50 книг к декабрю». Передавай target (число) и ' +
    'targetDate (срок), когда они есть; goalId — если правим существующую. ' +
    'Вызывай и на прямое «поставь/хочу цель …», и когда из разговора видно ' +
    'намерение, ещё не оформленное как цель (читай между строк).',
  category: 'task',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: {
    goal: 'goalText',
    text: 'goalText',
    title: 'goalText',
    goal_text: 'goalText',
    category: 'area',
    amount: 'target',
    sum: 'target',
    deadline: 'targetDate',
    by: 'targetDate',
    goal_id: 'goalId',
  },
  schema: z.object({
    area: z.enum(['finance', 'career', 'health', 'spirituality']),
    goalText: z.string().min(3).max(300),
    rationale: z
      .string()
      .min(3)
      .max(500)
      .describe('почему бот считает что это стоит цели'),
    target: z
      .number()
      .positive()
      .max(1_000_000_000)
      .optional()
      .describe('числовая величина измеримой цели: 100000 (₸), 50 (книг), 10 (кг)'),
    targetDate: z
      .string()
      .max(40)
      .optional()
      .describe('срок: YYYY-MM-DD или «к концу месяца»/«к декабрю»/«до июня 2027»'),
    goalId: z
      .string()
      .max(64)
      .optional()
      .describe('id существующей цели — если ПРАВИМ её (бот видит id целей в контексте)'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: [
    'предложи цель «бегать 3 раза в неделю»',
    'поставь цель накопить 100000 к концу месяца',
    'хочу накопить 3 млн к декабрю',
  ],
  handler: async (input, ctx) => {
    // НЕ пишем — ставим предложение и задаём вопрос. Запись на «да».
    const now = new Date();

    // Превью срока для вопроса (резолвим относительную фразу).
    let when = '';
    const rawDate =
      typeof input.targetDate === 'string' ? input.targetDate.trim() : '';
    if (rawDate) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? new Date(rawDate + 'T12:00:00Z')
        : parseGoalDeadline(rawDate, now);
      when = d ? ` к ${d.toISOString().slice(0, 10)}` : ` ${rawDate}`;
    }
    const amount =
      typeof input.target === 'number' && Number.isFinite(input.target)
        ? ` (${Math.round(input.target)}₸)`
        : '';

    const question =
      `Зафиксировать цель: «${input.goalText}»${amount}${when}? ` +
      `Скажи «да» — запишу и буду вести.`;

    await setPendingAction(
      ctx.userId,
      'commit_goal',
      {
        area: input.area,
        goalText: input.goalText,
        rationale: input.rationale,
        target: input.target,
        targetDate: input.targetDate,
        goalId: input.goalId,
      },
      question,
    );

    return { message: question, pending: true };
  },
});
