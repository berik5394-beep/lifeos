import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localDateStr } from '../lib/tz.js';
import { defineTool } from './_types.js';

/**
 * SSOT Step 3b — read-only. Сводка бюджета за текущий месяц.
 *
 * L99 R9 #7 fix (2026-05-27): теперь tz-aware границы месяца. Раньше
 * комментарий говорил «server TZ намеренно, coupled с write-side» —
 * это было true до R9. В R9 batch add_expense/add_income мигрировали
 * на localDayStartUTC(tz). Этот fix замыкает coherence: read и write
 * теперь смотрят на ОДИН локальный месяц юзера. Для Almaty юзера
 * больше не «майские расходы видны только с 1 мая 05:00 локально».
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
    // L99 R9 #7 fix: month bounds в локальной tz юзера.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const tz = user?.timezone || 'UTC';
    const todayLocal = localDateStr(tz); // "YYYY-MM-DD"
    const [yearStr, monthStr, dayStr] = todayLocal.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr); // 1-12
    const currentDay = Number(dayStr);
    // Последний день текущего месяца (calendar): trick — нулевой день
    // следующего месяца = last day текущего.
    const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
    // monthStart/monthEnd = UTC instant начала первого/последнего дня
    // месяца в tz юзера (mid-day UTC trick для надёжного попадания).
    const monthStart = localDayStartUTC(
      tz,
      new Date(`${yearStr}-${monthStr}-01T12:00:00Z`),
    );
    const lastDayStr = String(lastDayOfMonth).padStart(2, '0');
    const monthEnd = localDayStartUTC(
      tz,
      new Date(`${yearStr}-${monthStr}-${lastDayStr}T12:00:00Z`),
    );

    const [expenses, incomes, limits] = await Promise.all([
      prisma.expense.findMany({
        where: { userId, date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.income.aggregate({
        where: { userId, date: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
      }),
      prisma.budgetLimit.findMany({
        where: { userId, month: monthNum, year },
      }),
    ]);

    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const totalIncome = incomes._sum.amount ?? 0;
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }
    // daysLeft теперь по локальному дню юзера (раньше now.getDate() = server).
    const daysLeft = lastDayOfMonth - currentDay;
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
