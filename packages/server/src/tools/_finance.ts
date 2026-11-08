import { prisma } from '../lib/prisma.js';
import { getUserTimezone } from '../lib/user-context.js';
import { dateOnlyUTC, localDateStr } from '../lib/tz.js';
import { EXPENSE_LABELS } from '../lib/expense-category.js';

/**
 * SSOT Step 6 — чистый бюджет-анализ после расхода. Вынесен из
 * legacy action-executor (его сносят на Шаге 9), логика 1:1.
 *
 * R9 TZ-fix (2026-06-11): границы месяца и ключ лимита — МЕСЯЦ ЮЗЕРА
 * (зеркало get-budget). Старый комментарий «TZ сервера, намеренно»
 * устарел: add-expense пишет date=localDayStartUTC(tz), set_budget
 * ключует месяц юзера → серверный месяц здесь давал на границе месяца
 * (первые часы 1-го числа в +tz) лимит ЧУЖОГО месяца (не находился,
 * предупреждение молчало) и суммы чужих граничных дней.
 */
export async function analyzeBudgetAfterExpense(
  userId: string,
  category: string,
  now: Date = new Date(),
): Promise<{
  spent: number;
  budgetLimit: number;
  percentage: number;
  daysLeft: number;
  warning: string;
  dailyRemaining: number;
}> {
  const tz = await getUserTimezone(userId);
  const todayLocal = localDateStr(tz, now); // "YYYY-MM-DD" юзера
  const [yearStr, monthStr, dayStr] = todayLocal.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr); // 1-12, месяц ЮЗЕРА
  const currentDay = Number(dayStr);
  // Последний день месяца (календарь): нулевой день следующего месяца.
  const lastDayOfMonth = new Date(year, monthNum, 0).getDate();
  // UTC-инстанты начала первого/последнего ЛОКАЛЬНОГО дня месяца
  // (mid-day trick — как в get-budget — для надёжного попадания в день).
  // @db.Date — КАЛЕНДАРНЫЕ границы месяца (UTC-полночь дат). Инстанты локальной
    // полуночи (localDayStartUTC) выкидывали последний день месяца (ревью 2026-11-08).
    const monthStart = dateOnlyUTC(`${yearStr}-${monthStr}-01`);
  const lastDayStr = String(lastDayOfMonth).padStart(2, '0');
  const monthEnd = dateOnlyUTC(`${yearStr}-${monthStr}-${lastDayStr}`);

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
          month: monthNum,
          year,
        },
      },
    }),
  ]);

  const spent = expenses._sum.amount ?? 0;
  const budgetLimit = limit?.monthlyLimit ?? 0;
  const percentage = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
  const daysLeft = lastDayOfMonth - currentDay;

  let warning = '';
  if (budgetLimit > 0) {
    if (percentage > 100)
      warning = `⚠️ Бюджет на «${EXPENSE_LABELS[category] ?? category}» превышен на ${Math.round(
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
