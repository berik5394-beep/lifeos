import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';

/**
 * v2.0 Week 5 — propose a yearly goal. needsConfirm:true → never
 * executed by the autonomous agent loop (security invariant in
 * tools/index.ts agentToolSchemas filter). Confirm-FSM in
 * jarvis-orchestrator routes user «да» back to runRegistryTool here.
 */
export const suggestGoalTool = defineTool({
  name: 'suggest_goal',
  description:
    'Предложить пользователю записать долгосрочную (годовую) цель — ' +
    'юзер ОБЯЗАТЕЛЬНО подтверждает прежде чем цель попадёт в его ' +
    'годовой план. Используй когда из разговора видно сильное желание/' +
    'намерение, ещё не оформленное как цель.',
  category: 'task',
  schema: z.object({
    area: z.enum(['finance', 'career', 'health', 'spirituality']),
    goalText: z.string().min(3).max(300),
    rationale: z
      .string()
      .min(3)
      .max(500)
      .describe('почему бот считает что это стоит цели'),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['предложи цель «бегать 3 раза в неделю»'],
  handler: async (input, ctx) => {
    // Confirm-FSM ensures this fires only after the user said «да».
    const year = new Date().getFullYear();
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
  },
});
