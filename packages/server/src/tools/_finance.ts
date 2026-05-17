import { prisma } from '../lib/prisma.js';

/**
 * SSOT Step 6 — чистый бюджет-анализ после расхода. Вынесен из
 * legacy action-executor (его сносят на Шаге 9), логика 1:1.
 * Границы месяца — TZ сервера, НАМЕРЕННО консистентно с тем, как
 * Expense.date пишется (см. get-budget Step 3b; общий TZ — отдельно).
 */
export async function analyzeBudgetAfterExpense(
  userId: string,
  category: string,
): Promise<{
  spent: number;
  budgetLimit: number;
  percentage: number;
  daysLeft: number;
  warning: string;
  dailyRemaining: number;
}> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [expenses, limit] = await Promise.all([
    prisma.expense.aggregate({
      where: { userId, category, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.findUnique({
      where: {
        userId_category_month_year: {
          userId,
          category,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        },
      },
    }),
  ]);

  const spent = expenses._sum.amount ?? 0;
  const budgetLimit = limit?.monthlyLimit ?? 0;
  const percentage = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
  const daysLeft = monthEnd.getDate() - now.getDate();

  let warning = '';
  if (budgetLimit > 0) {
    if (percentage > 100)
      warning = `⚠️ Бюджет на ${category} превышен на ${Math.round(
        percentage - 100,
      )}%!`;
    else if (percentage > 80)
      warning = `⚡ Осторожно: ${Math.round(
        percentage,
      )}% бюджета на ${category} использовано.`;
  }

  return {
    spent,
    budgetLimit,
    percentage,
    daysLeft,
    warning,
    dailyRemaining:
      daysLeft > 0 ? Math.round((budgetLimit - spent) / daysLeft) : 0,
  };
}
