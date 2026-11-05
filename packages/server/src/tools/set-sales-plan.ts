import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import { setSalesPlan, fmtMoney } from '../services/deals/index.js';

export const setSalesPlanTool = defineTool({
  name: 'set_sales_plan',
  description: 'План продаж на текущий месяц в ₸: «план на ноябрь — 10 млн». Не цель года (это suggest_goal).',
  category: 'finance',
  aliases: { sum: 'amount', plan: 'amount' },
  schema: z.object({ amount: z.coerce.number().positive() }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['план продаж на месяц 10 млн', 'хочу продать на 5 миллионов в этом месяце'],
  handler: async (input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'функция отключена' };
    await setSalesPlan(ctx.userId, input.amount);
    return { message: `План продаж на месяц: ${fmtMoney(input.amount)}. Буду считать темп.` };
  },
});
