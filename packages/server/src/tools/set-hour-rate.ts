import { z } from 'zod';
import { defineTool } from './_types.js';
import { prisma } from '../lib/prisma.js';
import { money } from '../services/time-value.js';

/**
 * Цена часа пользователя (jarvis-roadmap №3 «время = деньги»). Хранится в
 * User.settings.hourRate. По ней робот говорит «совещание 2 ч ≈ 40 000 ₸
 * твоего времени». Не деньги на счету (это set_balance) и не доход (add_income).
 */
export const setHourRateTool = defineTool({
  name: 'set_hour_rate',
  description:
    'Запомнить, сколько стоит час времени пользователя (₸ за час): «мой час стоит 20 000», «моя ставка 15 тысяч в час». ' +
    'Если назван доход в месяц («зарабатываю 3 млн в месяц») — раздели на 160 рабочих часов. ' +
    'Это не баланс (set_balance) и не доход (add_income).',
  category: 'memory',
  aliases: { amount: 'rate', hourRate: 'rate', price: 'rate', perHour: 'rate' },
  schema: z.object({
    rate: z.coerce.number().positive().max(100_000_000).describe('₸ за один час'),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['мой час стоит 20 000', 'моя ставка 15 тысяч в час'],
  handler: async (input, ctx) => {
    const rate = Math.round(input.rate);
    // Атомарно в settings, не затирая другие ключи.
    await prisma.$executeRaw`
      UPDATE "User" SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{hourRate}', to_jsonb(${rate}::int), true)
      WHERE id = ${ctx.userId}`;
    return { message: `Запомнил: твой час — ${money(rate)}. Буду считать, во что обходятся длинные встречи.`, rate };
  },
});
