import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 3b — read-only. Сводка бюджета за текущий месяц.
 *
 * ВАЖНО: границы месяца берём в TZ сервера — НАМЕРЕННО, 1:1 с тем,
 * как Expense.date пишется сейчас (new Date()+setHours(0) у legacy
 * add_expense). Менять только чтение на TZ-юзера = промах по строкам
 * (tz.ts сам предупреждает). Согласованная TZ read+write для финансов
 * — Шаг 6 (вместе с миграцией add_expense/add_income).
 */
export const getBudgetTool = defineTool({
  name: 'get_budget',
  description:
    'Сводка бюджета за текущий месяц: потрачено, доход, по ' +
    'категориям, лимиты, остаток дней и дневной бюджет. Вызывай на ' +
    '«как у меня с деньгами», «сколько потратил», «уложусь ли в бюджет».',
  category: 'finance',
  schema: z.object({}),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['как у меня с бюджетом', 'сколько я потратил в этом месяце'],
  handler: async (_input, ctx) => {
    const userId = ctx.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [expenses, incomes, limits] = await Promise.all([
      prisma.expense.findMany({
        where: { userId, date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.income.aggregate({
        where: { userId, date: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      prisma.budgetLimit.findMany({
        where: {
          userId,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        },
      }),
    ]);

    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = incomes._sum.amount ?? 0;
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }
    const daysLeft = monthEnd.getDate() - now.getDate();
    const dailyBudget =
      daysLeft > 0 ? Math.round((totalIncome - totalSpent) / daysLeft) : 0;

    return {
      totalSpent,
      totalIncome,
      byCategory,
      limits: limits.map((l) => ({
        category: l.category,
        limit: l.monthlyLimit,
      })),
      daysLeft,
      dailyBudget,
    };
  },
});
