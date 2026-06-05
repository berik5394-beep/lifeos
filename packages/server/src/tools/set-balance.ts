import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { isV2RunwayBalanceEnabled } from '../lib/feature-flags.js';
import { defineTool } from './_types.js';

/**
 * Текущий баланс на счету со слов юзера → CashSnapshot (точка отсчёта runway).
 * ДЕНЬГИ-факт: needsConfirm:true. Не денежный ledger — на суммы трат/доходов
 * не влияет, только на якорь runway. Запись после явного «да».
 */
export const setBalanceTool = defineTool({
  name: 'set_balance',
  description:
    'Запомнить текущий баланс на счету (со слов пользователя), чтобы точно ' +
    'считать «на сколько хватит денег». Выполняется только после явного ' +
    'подтверждения («да»). Не подтверждай сам.',
  category: 'finance',
  aliases: {
    amount: 'balance',
    sum: 'balance',
    cash: 'balance',
    счёт: 'balance',
    на_счету: 'balance',
  },
  schema: z.object({
    balance: z.coerce.number().positive().max(1_000_000_000),
    asOf: z.string().optional(),
  }),
  needsConfirm: true,
  sideEffects: 'write',
  examples: ['на счету 500000', 'у меня 350 тысяч на карте', 'баланс 1.2 млн'],
  handler: async (input, ctx) => {
    if (!isV2RunwayBalanceEnabled(ctx.userId)) return { error: 'функция отключена' };
    const tz = await getUserTimezone(ctx.userId);
    let asOf = localDayStartUTC(tz);
    if (input.asOf) {
      const d = new Date(input.asOf);
      if (!Number.isNaN(d.getTime())) asOf = d;
    }
    await prisma.cashSnapshot.create({
      data: { userId: ctx.userId, balance: input.balance, asOf },
    });
    let message = `Записал баланс ${Math.round(input.balance)} ₸.`;
    try {
      // Lazy-import: статический импорт создал бы цикл tool→runway→reflector→
      // tools/index→tool (setBalanceTool undefined на загрузке реестра).
      const { buildRunway } = await import('../services/runway/runway.js');
      const rw = await buildRunway(ctx.userId);
      if (rw?.insightText) message += ` ${rw.insightText}`;
    } catch {
      // проекция best-effort — баланс уже сохранён
    }
    return { message };
  },
});
