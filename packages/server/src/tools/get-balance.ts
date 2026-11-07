import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';
import { localMonthOnlyUTC } from '../lib/tz.js';
import { getUserTimezone } from '../lib/user-context.js';
import { computeAnchoredCash } from '../services/runway/types.js';

/**
 * Деньги на руках: последний названный баланс + доходы/расходы после него,
 * плюс доход/расход текущего месяца. Раньше на «сколько у меня денег?»
 * у мозга был только get_budget (расходы и лимиты).
 */
export const getBalanceTool = defineTool({
  name: 'get_balance',
  description:
    'Сколько денег на руках: последний баланс, который назвал юзер, и оценка сейчас с учётом доходов и расходов после него; ' +
    'доход и расход текущего месяца. Вызывай на «сколько у меня денег», «какой баланс», «сколько заработал в этом месяце».',
  category: 'finance',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['сколько у меня денег', 'какой у меня баланс'],
  handler: async (_input, ctx) => {
    const userId = ctx.userId;
    const tz = await getUserTimezone(userId);
    const monthStart = localMonthOnlyUTC(tz);
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const [snap, mInc, mExp] = await Promise.all([
      prisma.cashSnapshot.findFirst({ where: { userId }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }),
      prisma.income.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: monthStart, lt: nextMonth } } }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: monthStart, lt: nextMonth } } }),
    ]);
    let estimateNow: number | null = null;
    if (snap) {
      const [inc, exp] = await Promise.all([
        prisma.income.aggregate({ _sum: { amount: true }, where: { userId, date: { gt: snap.asOf } } }),
        prisma.expense.aggregate({ _sum: { amount: true }, where: { userId, date: { gt: snap.asOf } } }),
      ]);
      estimateNow = computeAnchoredCash({ balance: snap.balance, incomesSince: inc._sum.amount ?? 0, expensesSince: exp._sum.amount ?? 0 });
    }
    return {
      lastStatedBalance: snap ? { amount: snap.balance, asOf: snap.asOf.toISOString().slice(0, 10) } : null,
      estimateNow,
      note: snap ? null : 'Баланс юзер ещё не называл — точной суммы на руках нет, не выдумывай.',
      thisMonth: { income: mInc._sum.amount ?? 0, expense: mExp._sum.amount ?? 0 },
    };
  },
});
