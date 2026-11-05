import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { defineTool } from './_types.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';

/**
 * SSOT Step 6 — ДЕНЬГИ. needsConfirm:true (гейт на инструменте).
 * Логика 1:1 с legacy add_income. Запись только после явного «да».
 */
export const addIncomeTool = defineTool({
  name: 'add_income',
  description:
    'Записать доход. ДЕНЬГИ — выполняется только после явного ' +
    'подтверждения пользователя («да»). Не подтверждай сам. ' +
    'Получил деньги по открытой сделке («Ахмет оплатил 2 млн») — update_deal (он предложит доход сам), не я.',
  category: 'finance',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { sum: 'amount', cost: 'amount', from: 'source', description: 'source', desc: 'source', note: 'source' },
  schema: z.object({
    amount: z.coerce.number().positive().max(MAX_MONEY_AMOUNT),
    source: z.string().max(120).optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['получил зарплату 350000', 'запиши доход 50000 от фриланса'],
  handler: async (input, ctx) => {
    // R9 TZ-aware: «сегодня» в локальной TZ юзера.
    const tz = await getUserTimezone(ctx.userId);
    const today = localDayStartUTC(tz);
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
