import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 6 — ДЕНЬГИ. needsConfirm:true (гейт на инструменте).
 * Логика 1:1 с legacy add_income. Запись только после явного «да».
 */
export const addIncomeTool = defineTool({
  name: 'add_income',
  description:
    'Записать доход. ДЕНЬГИ — выполняется только после явного ' +
    'подтверждения пользователя («да»). Не подтверждай сам.',
  category: 'finance',
  schema: z.object({
    amount: z.number().positive().max(1_000_000_000),
    source: z.string().max(120).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['получил зарплату 350000', 'запиши доход 50000 от фриланса'],
  handler: async (input, ctx) => {
    // L99 R9 #15 fix: «сегодня» в локальной TZ юзера.
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const today = localDayStartUTC(user?.timezone || 'UTC');
    const income = await prisma.income.create({
      data: {
        userId: ctx.userId,
        date: today,
        amount: input.amount,
        source: input.source || '',
      },
    });
    return {
      message: `Доход ${input.amount} ₸ записан${
        input.source ? ' (' + input.source + ')' : ''
      }`,
      incomeId: income.id,
    };
  },
});
