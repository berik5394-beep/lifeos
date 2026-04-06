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
    return reply.status(201).send(expense);
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
}
