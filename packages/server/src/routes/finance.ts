import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseMonth as validateMonth, invalidDateReply } from '../middleware/validate.js';
import { captureActivity } from '../services/tool-activity-summary.js';

// B.3: enum-валидация категории (аудит 3.12 — раньше любая строка).
// Список из CLAUDE.md (expenseCategories).
const EXPENSE_CATEGORY = z.enum([
  'food',
  'transport',
  'entertainment',
  'clothing',
  'health',
  'home',
  'other',
]);

const createExpenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  category: EXPENSE_CATEGORY,
  description: z.string().min(1, 'Описание обязательно').max(500),
  amount: z.number().positive('Сумма должна быть положительной'),
});

const createBudgetSchema = z.object({
  category: EXPENSE_CATEGORY,
  monthlyLimit: z.number().positive('Лимит должен быть положительным'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
});

const createIncomeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  source: z.string().min(1, 'Источник обязателен').max(200),
  amount: z.number().positive('Сумма должна быть положительной'),
});

function parseMonthLocal(month: string) {
  const result = validateMonth(month);
  return result;
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Summary ---

  app.get('/finance/summary/:month', async (request, reply) => {
    const { month } = request.params as { month: string };
    const range = parseMonthLocal(month);
    if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
    const { start, end } = range;

    const [expenses, incomes, topExpenses] = await Promise.all([
      prisma.expense.aggregate({
        where: { userId: request.userId, date: { gte: start, lt: end } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.income.aggregate({
        where: { userId: request.userId, date: { gte: start, lt: end } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId: request.userId, date: { gte: start, lt: end } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
    ]);

    const totalExpenses = expenses._sum.amount ?? 0;
    const totalIncomes = incomes._sum.amount ?? 0;

    return {
      totalExpenses,
      totalIncomes,
      balance: totalIncomes - totalExpenses,
      expenseCount: expenses._count,
      incomeCount: incomes._count,
      topCategories: topExpenses.map((e) => ({
        category: e.category,
        amount: e._sum.amount ?? 0,
      })),
    };
  });

  // --- Expenses ---

  app.get('/finance/expenses', async (request, reply) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const range = parseMonthLocal(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
      const { start, end } = range;
      return prisma.expense.findMany({
        where: { userId: request.userId, date: { gte: start, lt: end } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
    }

    return prisma.expense.findMany({
      where: { userId: request.userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  });

  app.post('/finance/expenses', {
    preHandler: validate(createExpenseSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createExpenseSchema>;

    const expenseDate = new Date(data.date);
    const expMonth = expenseDate.getMonth() + 1;
    const expYear = expenseDate.getFullYear();
    const monthStart = new Date(expYear, expMonth - 1, 1);
    const monthEnd = new Date(expYear, expMonth, 1);

    // ATOMIC: insert the expense and recompute the monthly total for its
    // category inside a single transaction. Without this, two parallel
    // voice inputs ("потратил 3000 на еду, ещё 2000 на такси") can both
    // insert and then both read a stale aggregate — producing wrong
    // "percentage of budget used" in the response and confusing warnings.
    const { expense, budgetLimit, spent } = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          date: expenseDate,
          category: data.category,
          description: data.description,
          amount: data.amount,
          userId: request.userId,
        },
      });

      const budgetLimit = await tx.budgetLimit.findUnique({
        where: {
          userId_category_month_year: {
            userId: request.userId,
            category: data.category,
            month: expMonth,
            year: expYear,
          },
        },
      });

      let spent = 0;
      if (budgetLimit) {
        const totalSpent = await tx.expense.aggregate({
          where: {
            userId: request.userId,
            category: data.category,
            date: { gte: monthStart, lt: monthEnd },
          },
          _sum: { amount: true },
        });
        spent = totalSpent._sum.amount ?? 0;
      }

      return { expense, budgetLimit, spent };
    });

    let budgetInfo: {
      limit: number;
      spent: number;
      percentage: number;
      warning?: string;
    } | undefined;

    if (budgetLimit) {
      const percentage = Math.round((spent / budgetLimit.monthlyLimit) * 100);
      budgetInfo = {
        limit: budgetLimit.monthlyLimit,
        spent,
        percentage,
      };

      if (percentage >= 100) {
        budgetInfo.warning = `Лимит по категории "${data.category}" превышен!`;
      } else if (percentage >= 80) {
        budgetInfo.warning = `Потрачено ${percentage}% лимита по категории "${data.category}"`;
      }
    }

    captureActivity(request.userId, {
      type: 'expense_added',
      content: `Расход ${data.amount} ₸ · ${data.category} · ${data.description}`,
    });
    return reply.status(201).send({
      ...expense,
      ...(budgetInfo ? { budgetInfo } : {}),
    });
  });

  app.delete('/finance/expenses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const expense = await prisma.expense.findFirst({
      where: { id, userId: request.userId },
    });
    if (!expense) {
      return reply.status(404).send({ message: 'Расход не найден' });
    }
    await prisma.expense.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // --- Incomes ---

  app.get('/finance/incomes', async (request, reply) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const range = parseMonthLocal(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
      const { start, end } = range;
      return prisma.income.findMany({
        where: { userId: request.userId, date: { gte: start, lt: end } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
    }

    return prisma.income.findMany({
      where: { userId: request.userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  });

  app.post('/finance/incomes', {
    preHandler: validate(createIncomeSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createIncomeSchema>;
    const income = await prisma.income.create({
      data: {
        date: new Date(data.date),
        source: data.source,
        amount: data.amount,
        userId: request.userId,
      },
    });
    captureActivity(request.userId, {
      type: 'income_added',
      content: `Доход ${data.amount} ₸ · ${data.source}`,
    });
    return reply.status(201).send(income);
  });

  app.delete('/finance/incomes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const income = await prisma.income.findFirst({
      where: { id, userId: request.userId },
    });
    if (!income) {
      return reply.status(404).send({ message: 'Доход не найден' });
    }
    await prisma.income.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // --- Budget Limits ---

  app.get('/finance/budget/:month', async (request, reply) => {
    const { month } = request.params as { month: string };
    const range = parseMonthLocal(month);
    if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
    const year = range.start.getFullYear();
    const m = range.start.getMonth() + 1;

    return prisma.budgetLimit.findMany({
      where: { userId: request.userId, year, month: m },
    });
  });

  app.post('/finance/budget', {
    preHandler: validate(createBudgetSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createBudgetSchema>;

    const budget = await prisma.budgetLimit.upsert({
      where: {
        userId_category_month_year: {
          userId: request.userId,
          category: data.category,
          month: data.month,
          year: data.year,
        },
      },
      update: {
        monthlyLimit: data.monthlyLimit,
      },
      create: {
        userId: request.userId,
        category: data.category,
        monthlyLimit: data.monthlyLimit,
        month: data.month,
        year: data.year,
      },
    });

    captureActivity(request.userId, {
      type: 'budget_set',
      content: `Лимит ${data.category}: ${data.monthlyLimit} ₸ (${data.month}/${data.year})`,
    });
    return reply.status(201).send(budget);
  });

  // --- Financial Advice ---

  app.get('/finance/advice', async (request) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const daysInMonth = new Date(year, month, 0).getDate();
    const currentDay = now.getDate();
    const daysRemaining = daysInMonth - currentDay;

    const [expensesByCategory, budgetLimits, totalExpenses] = await Promise.all([
      prisma.expense.groupBy({
        by: ['category'],
        where: {
          userId: request.userId,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
      prisma.budgetLimit.findMany({
        where: { userId: request.userId, year, month },
      }),
      prisma.expense.aggregate({
        where: {
          userId: request.userId,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const budgetMap = new Map(
      budgetLimits.map((b) => [b.category, b.monthlyLimit]),
    );

    const categories = expensesByCategory.map((e) => {
      const spent = e._sum.amount ?? 0;
      const limit = budgetMap.get(e.category) ?? 0;
      const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;

      let status: string;
      if (limit === 0) {
        status = 'no_limit';
      } else if (percentage >= 100) {
        status = 'exceeded';
      } else if (percentage >= 80) {
        status = 'warning';
      } else {
        status = 'ok';
      }

      return { category: e.category, spent, limit, percentage, status };
    });

    const totalSpent = totalExpenses._sum.amount ?? 0;
    const totalBudget = budgetLimits.reduce((sum, b) => sum + b.monthlyLimit, 0);
    const dailyBudget = daysRemaining > 0
      ? Math.round((totalBudget - totalSpent) / daysRemaining)
      : 0;

    const adviceParts: string[] = [];

    for (const cat of categories) {
      if (cat.status === 'exceeded') {
        adviceParts.push(
          `На "${cat.category}" потрачено ${cat.percentage}% лимита — превышение!`,
        );
      } else if (cat.status === 'warning') {
        adviceParts.push(
          `На "${cat.category}" потрачено ${cat.percentage}% лимита.`,
        );
      }
    }

    if (daysRemaining > 0 && dailyBudget > 0) {
      adviceParts.push(
        `Осталось ${daysRemaining} дней, по ${dailyBudget}₸/день.`,
      );
    } else if (daysRemaining > 0 && totalBudget > 0 && totalSpent >= totalBudget) {
      adviceParts.push(
        `Бюджет на месяц исчерпан. Осталось ${daysRemaining} дней.`,
      );
    }

    const advice = adviceParts.length > 0
      ? adviceParts.join(' ')
      : 'Финансы в порядке. Продолжайте в том же духе!';

    return {
      categories,
      totalSpent,
      totalBudget,
      daysRemaining,
      dailyBudget,
      advice,
    };
  });
}
