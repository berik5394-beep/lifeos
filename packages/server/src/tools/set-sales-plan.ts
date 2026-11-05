import { z } from 'zod';
import { defineTool } from './_types.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import { setSalesPlan, fmtMoney } from '../services/deals/index.js';
import { MAX_MONEY_AMOUNT } from '../lib/money.js';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export const setSalesPlanTool = defineTool({
  name: 'set_sales_plan',
  description:
    'План продаж на месяц в ₸: «план на месяц — 10 млн». Другой месяц («план на декабрь») — month: YYYY-MM. ' +
    'Не цель года (это suggest_goal).',
  category: 'finance',
  aliases: { sum: 'amount', plan: 'amount' },
  schema: z.object({
    amount: z.coerce.number().positive().max(MAX_MONEY_AMOUNT),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM').nullable().optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['план продаж на месяц 10 млн', 'хочу продать на 5 миллионов в этом месяце'],
  handler: async (input, ctx) => {
    if (!isV2DealsEnabled(ctx.userId)) return { error: 'deals_disabled', hint: 'сделки выключены — денежную цель месяца ставь через create_monthly_goal' };
    const month = input.month ?? undefined;
    await setSalesPlan(ctx.userId, input.amount, new Date(), month);
    const label = month ? `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` : 'месяц';
    return { message: `План продаж на ${label}: ${fmtMoney(input.amount)}. Буду считать темп.` };
  },
});
