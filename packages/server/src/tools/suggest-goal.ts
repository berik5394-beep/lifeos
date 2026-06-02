import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { decideGoalWrite } from '../services/goal-write.js';
import { parseGoalDeadline } from '../services/goal-deadline.js';
import { isV2SavingsCoachEnabled } from '../lib/feature-flags.js';

/**
 * v2.0 Week 5 — записать/обновить годовую цель. needsConfirm:true →
 * никогда не исполняется автономным agent-loop (security invariant в
 * tools/index.ts agentToolSchemas). Confirm-FSM в jarvis-orchestrator
 * ведёт «да» юзера обратно сюда.
 *
 * 2026-06 — единый умный захват цели (spec financial-goal-capture).
 * За флагом FEATURE_V2_SAVINGS_COACH: пишет ИЗМЕРИМУЮ величину
 * (`target`) + срок (`targetDate`) и делает create-OR-update (не плодит
 * дубли, закрывает правку). Так коуч по накоплениям получает фин-цель
 * с числом+сроком, которую читает. Флаг off → поведение как раньше
 * (always create, без target/срока) — байт-в-байт.
 */
export const suggestGoalTool = defineTool({
  name: 'suggest_goal',
  description:
    'Записать или обновить годовую цель пользователя, в т.ч. ИЗМЕРИМУЮ ' +
    '(сумма+срок): «накопить 100000 к концу месяца», «прочитать 50 книг ' +
    'к декабрю». Юзер подтверждает. Передавай target (число) и targetDate ' +
    '(срок) когда они есть; goalId — если ПРАВИШЬ существующую цель. ' +
    'Вызывай и на прямое «поставь/хочу цель …», и когда из разговора ' +
    'видно намерение, ещё не оформленное как цель.',
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
  needsConfirm: true,
  sideEffects: 'write',
  examples: [
    'предложи цель «бегать 3 раза в неделю»',
    'поставь цель накопить 100000 к концу месяца',
    'хочу накопить 3 млн к декабрю',
  ],
  handler: async (input, ctx) => {
    // Confirm-FSM ensures this fires only after the user said «да».
    const now = new Date();
    const year = now.getFullYear();

    // Флаг off → поведение как раньше: всегда create, без target/срока.
    if (!isV2SavingsCoachEnabled(ctx.userId)) {
      const goal = await prisma.yearlyGoal.create({
        data: {
          userId: ctx.userId,
          year,
          area: input.area,
          goalText: input.goalText,
        },
      });
      return {
        message: `Цель записана: «${input.goalText}» (${input.area}, ${year})`,
        goalId: goal.id,
      };
    }

    // Резолв срока: ISO как есть, иначе относительная фраза → дата.
    let targetDate: Date | null = null;
    const rawDate =
      typeof input.targetDate === 'string' ? input.targetDate.trim() : '';
    if (rawDate) {
      targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? new Date(rawDate + 'T12:00:00Z')
        : parseGoalDeadline(rawDate, now);
    }
    const target =
      typeof input.target === 'number' && Number.isFinite(input.target)
        ? input.target
        : null;

    // create-OR-update: не плодим дубли, закрываем правку.
    const existing = await prisma.yearlyGoal.findMany({
      where: { userId: ctx.userId, year, area: input.area },
      select: { id: true, goalText: true },
    });
    const decision = decideGoalWrite(existing, {
      goalId: input.goalId,
      goalText: input.goalText,
    });

    const fields = {
      goalText: input.goalText,
      ...(target !== null ? { target } : {}),
      ...(targetDate !== null ? { targetDate } : {}),
    };

    let goalId: string;
    let verb: string;
    if (decision.mode === 'update') {
      const g = await prisma.yearlyGoal.update({
        where: { id: decision.goalId },
        data: fields,
      });
      goalId = g.id;
      verb = 'обновлена';
    } else {
      const g = await prisma.yearlyGoal.create({
        data: { userId: ctx.userId, year, area: input.area, ...fields },
      });
      goalId = g.id;
      verb = 'записана';
    }

    const parts = [`«${input.goalText}»`];
    if (target !== null) parts.push(`${Math.round(target)}`);
    if (targetDate) parts.push(`к ${targetDate.toISOString().slice(0, 10)}`);
    return {
      message: `Цель ${verb}: ${parts.join(' ')} (${input.area})`,
      goalId,
    };
  },
});
