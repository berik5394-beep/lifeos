import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const createExpenseSchema = z.object({
  date: z.string(),
  category: z.string(),
  description: z.string().min(1, 'Описание обязательно'),
  amount: z.number().positive('Сумма должна быть положительной'),
});

const createBudgetSchema = z.object({
  category: z.string().min(1, 'Категория обязательна'),
  monthlyLimit: z.number().positive('Лимит должен быть положительным'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
});

const createIncomeSchema = z.object({
  date: z.string(),
  source: z.string().min(1, 'Источник обязателен'),
  amount: z.number().positive('Сумма должна быть положительной'),
});

function parseMonth(month: string) {
  const [year, m] = month.split('-').map(Number);
  const start = new Date(year, m - 1, 1);
  const end = new Date(year, m, 1);
  return { start, end };
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Summary ---

  app.get('/finance/summary/:month', async (request) => {
    const { month } = request.params as { month: string };
    const { start, end } = parseMonth(month);

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

  app.get('/finance/expenses', async (request) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const { start, end } = parseMonth(month);
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
    const expense = await prisma.expense.create({
      data: {
        ...data,
        date: new Date(data.date),
        userId: request.userId,
      },
    });

    const expenseDate = new Date(data.date);
    const expMonth = expenseDate.getMonth() + 1;
    const expYear = expenseDate.getFullYear();

    const budgetLimit = await prisma.budgetLimit.findUnique({
      where: {
        userId_category_month_year: {
          userId: request.userId,
          category: data.category,
          month: expMonth,
          year: expYear,
        },
      },
    });

    let budgetInfo: {
      limit: number;
      spent: number;
      percentage: number;
      warning?: string;
    } | undefined;

    if (budgetLimit) {
      const monthStart = new Date(expYear, expMonth - 1, 1);
      const monthEnd = new Date(expYear, expMonth, 1);

      const totalSpent = await prisma.expense.aggregate({
        where: {
          userId: request.userId,
          category: data.category,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      });

      const spent = totalSpent._sum.amount ?? 0;
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

  app.get('/finance/incomes', async (request) => {
    const { month } = request.query as { month?: string };

    if (month) {
      const { start, end } = parseMonth(month);
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
        ...data,
        date: new Date(data.date),
        userId: request.userId,
      },
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

  app.get('/finance/budget/:month', async (request) => {
    const { month } = request.params as { month: string };
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const m = Number(monthStr);

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
