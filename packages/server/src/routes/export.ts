import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const pdfReportSchema = z.object({
  period: z.enum(['month', 'year']),
  date: z.string().optional(),
});

function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvField).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Export CSV ---

  app.post('/export/csv/:module', async (request, reply) => {
    const { module } = request.params as { module: string };
    const userId = request.userId;

    let csv: string;

    switch (module) {
      case 'finance': {
        const [expenses, incomes] = await Promise.all([
          prisma.expense.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
          }),
          prisma.income.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
          }),
        ]);

        const headers = ['Тип', 'Дата', 'Категория/Источник', 'Описание', 'Сумма'];
        const rows: (string | number | boolean | null)[][] = [
          ...expenses.map((e) => [
            'Расход' as string,
            e.date.toISOString().split('T')[0],
            e.category,
            e.description,
            -e.amount,
          ]),
          ...incomes.map((i) => [
            'Доход' as string,
            i.date.toISOString().split('T')[0],
            i.source,
            '' as string,
            i.amount,
          ]),
        ];

        csv = toCsv(headers, rows);
        break;
      }

      case 'habits': {
        const habits = await prisma.habit.findMany({
          where: { userId },
          include: {
            logs: {
              where: { completed: true },
              orderBy: { date: 'desc' },
            },
          },
        });

        const headers = ['Привычка', 'Категория', 'Частота', 'Активна', 'Дата выполнения', 'Авто'];
        const rows: (string | number | boolean | null)[][] = [];

        for (const habit of habits) {
          if (habit.logs.length === 0) {
            rows.push([habit.name, habit.category, habit.frequency, habit.active ? 'Да' : 'Нет', '', '']);
          } else {
            for (const log of habit.logs) {
              rows.push([
                habit.name,
                habit.category,
                habit.frequency,
                habit.active ? 'Да' : 'Нет',
                log.date.toISOString().split('T')[0],
                log.autoCompleted ? 'Да' : 'Нет',
              ]);
            }
          }
        }

        csv = toCsv(headers, rows);
        break;
      }

      case 'tasks': {
        const tasks = await prisma.task.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
        });

        const headers = ['Задача', 'Категория', 'Приоритет', 'Дата', 'Время', 'Выполнена', 'Заметки'];
        const rows = tasks.map((t) => [
          t.title,
          t.category,
          t.priority,
          t.date.toISOString().split('T')[0],
          t.time ?? '',
          t.completed ? 'Да' : 'Нет',
          t.notes ?? '',
        ]);

        csv = toCsv(headers, rows);
        break;
      }

      default:
        return reply.status(400).send({
          message: `Неподдерживаемый модуль: ${module}. Доступны: finance, habits, tasks`,
        });
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${module}_export.csv"`)
      .send(csv);
  });

  // --- PDF Report ---

  app.post('/export/pdf/report', {
    preHandler: validate(pdfReportSchema),
  }, async (request, reply) => {
    const { period, date } = request.body as z.infer<typeof pdfReportSchema>;
    const userId = request.userId;

    const refDate = date ? new Date(date) : new Date();
    let startDate: Date;
    let endDate: Date;

    if (period === 'month') {
      startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
      endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1);
    } else {
      startDate = new Date(refDate.getFullYear(), 0, 1);
      endDate = new Date(refDate.getFullYear() + 1, 0, 1);
    }

    const [
      tasks,
      completedTasks,
      habitLogs,
      activeHabits,
      expenseTotal,
      incomeTotal,
      topExpenses,
    ] = await Promise.all([
      prisma.task.count({
        where: { userId, date: { gte: startDate, lt: endDate } },
      }),
      prisma.task.count({
        where: { userId, date: { gte: startDate, lt: endDate }, completed: true },
      }),
      prisma.habitLog.count({
        where: { userId, date: { gte: startDate, lt: endDate }, completed: true },
      }),
      prisma.habit.count({
        where: { userId, active: true },
      }),
      prisma.expense.aggregate({
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.income.aggregate({
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
    ]);

    const totalExpenses = expenseTotal._sum.amount ?? 0;
    const totalIncomes = incomeTotal._sum.amount ?? 0;

    const reportData = {
      period,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      tasks: {
        total: tasks,
        completed: completedTasks,
        completionRate: tasks > 0 ? Math.round((completedTasks / tasks) * 100) : 0,
      },
      habits: {
        activeCount: activeHabits,
        totalCompletions: habitLogs,
      },
      finance: {
        totalExpenses,
        totalIncomes,
        balance: totalIncomes - totalExpenses,
        topCategories: topExpenses.map((e) => ({
          category: e.category,
          amount: e._sum.amount ?? 0,
        })),
      },
    };

    return reply.send({
      reportData,
      message: 'Отчёт сгенерирован',
    });
  });

  // --- Instagram Story Data ---

  app.post('/export/story', async (request, reply) => {
    const userId = request.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [
      todayTasks,
      todayCompletedTasks,
      weekTasks,
      weekCompletedTasks,
      todayHabitLogs,
      activeHabits,
      todaySteps,
    ] = await Promise.all([
      prisma.task.count({
        where: { userId, date: today },
      }),
      prisma.task.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.task.count({
        where: { userId, date: { gte: weekStart, lt: weekEnd } },
      }),
      prisma.task.count({
        where: { userId, date: { gte: weekStart, lt: weekEnd }, completed: true },
      }),
      prisma.habitLog.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.habit.count({
        where: { userId, active: true },
      }),
      prisma.stepLog.findUnique({
        where: { userId_date: { userId, date: today } },
        select: { steps: true, distanceKm: true },
      }),
    ]);

    // Calculate streak
    let streak = 0;
    const checkDate = new Date(today);
    const habitsCount = activeHabits;

    if (habitsCount > 0) {
      for (let i = 0; i < 365; i++) {
        const dayDate = new Date(checkDate);
        dayDate.setDate(dayDate.getDate() - i);

        const completedLogs = await prisma.habitLog.count({
          where: { userId, date: dayDate, completed: true },
        });

        const completionRate = completedLogs / habitsCount;

        if (completionRate > 0.5) {
          streak++;
        } else {
          if (i === 0 && completedLogs === 0) continue;
          break;
        }
      }
    }

    return reply.send({
      title: 'Мой прогресс в LifeOS',
      stats: {
        tasksCompletedToday: todayCompletedTasks,
        tasksTotalToday: todayTasks,
        tasksCompletedWeek: weekCompletedTasks,
        tasksTotalWeek: weekTasks,
        habitsCompletedToday: todayHabitLogs,
        habitsTotalToday: activeHabits,
        habitsStreak: streak,
        stepsToday: todaySteps?.steps ?? 0,
        distanceToday: todaySteps?.distanceKm ?? 0,
      },
      style: 'dark',
    });
  });
}
