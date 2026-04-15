import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const MOTIVATIONAL_QUOTES = [
  'Каждый день — это новый шанс стать лучше.',
  'Маленькие шаги каждый день приводят к большим результатам.',
  'Дисциплина — это мост между целями и результатами.',
  'Успех — это сумма маленьких усилий, повторяемых изо дня в день.',
  'Не жди идеального момента — создай его.',
  'Твой единственный предел — это ты сам.',
  'Лучшее время действовать — сейчас.',
  'Прогресс, а не совершенство.',
  'Сделай сегодня то, что другие не хотят — завтра будешь жить так, как другие не могут.',
  'Сложности — это просто возможности в рабочей одежде.',
  'Не считай дни — делай так, чтобы каждый день считался.',
  'Ты сильнее, чем думаешь.',
  'Каждое утро — это возможность начать заново.',
  'Путь в тысячу миль начинается с одного шага.',
  'Будь тем изменением, которое хочешь видеть.',
];

function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

function getToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start, end };
}

export async function briefingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /briefing/morning — утренний брифинг
  app.get('/briefing/morning', async (request) => {
    const userId = request.userId;
    const today = getToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start: monthStart, end: monthEnd } = getMonthRange();

    const [tasks, events, habits, habitLogs, expenses, budgetLimits, pet, stepLog] =
      await Promise.all([
        // Задачи на сегодня
        prisma.task.findMany({
          where: { userId, date: today },
          orderBy: [{ priority: 'desc' }, { time: 'asc' }],
          select: {
            id: true,
            title: true,
            category: true,
            priority: true,
            time: true,
            completed: true,
          },
        }),
        // События на сегодня
        prisma.calendarEvent.findMany({
          where: { userId, date: today },
          orderBy: { startTime: 'asc' },
          select: {
            id: true,
            title: true,
            startTime: true,
            endTime: true,
            location: true,
          },
        }),
        // Привычки пользователя
        prisma.habit.findMany({
          where: { userId, active: true },
          select: { id: true, name: true, category: true },
        }),
        // Логи привычек за сегодня
        prisma.habitLog.findMany({
          where: { userId, date: today, completed: true },
          select: { habitId: true },
        }),
        // Расходы за месяц
        prisma.expense.findMany({
          where: {
            userId,
            date: { gte: monthStart, lte: monthEnd },
          },
          select: { amount: true, category: true },
        }),
        // Лимиты бюджета
        prisma.budgetLimit.findMany({
          where: {
            userId,
            month: today.getMonth() + 1,
            year: today.getFullYear(),
          },
          select: { category: true, monthlyLimit: true },
        }),
        // Питомец
        prisma.pet.findFirst({
          where: { userId },
          select: { health: true, happiness: true, level: true, streak: true, isAlive: true },
        }),
        // Шаги за сегодня
        prisma.stepLog.findFirst({
          where: { userId, date: today },
          select: { steps: true },
        }),
      ]);

    // Считаем прогресс привычек
    const completedHabitIds = new Set(habitLogs.map((l) => l.habitId));
    const habitsCompleted = habits.filter((h) => completedHabitIds.has(h.id)).length;
    const habitsTotal = habits.length;

    // Считаем прогресс задач
    const tasksCompleted = tasks.filter((t) => t.completed).length;
    const tasksTotal = tasks.length;

    // Бюджет
    const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalLimit = budgetLimits.reduce((sum, b) => sum + b.monthlyLimit, 0);
    const daysInMonth = monthEnd.getDate();
    const dayOfMonth = today.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // Категории с превышением
    const spentByCategory: Record<string, number> = {};
    for (const e of expenses) {
      spentByCategory[e.category] = (spentByCategory[e.category] || 0) + e.amount;
    }
    const overBudgetCategories: string[] = [];
    for (const b of budgetLimits) {
      const spent = spentByCategory[b.category] || 0;
      if (spent > b.monthlyLimit * 0.8) {
        overBudgetCategories.push(b.category);
      }
    }

    // Стрик
    const streak = pet?.streak ?? 0;

    return {
      date: today.toISOString().split('T')[0],
      quote: getRandomQuote(),
      tasks: {
        items: tasks,
        completed: tasksCompleted,
        total: tasksTotal,
      },
      events: {
        items: events,
        total: events.length,
      },
      habits: {
        completed: habitsCompleted,
        total: habitsTotal,
        progress: habitsTotal > 0 ? `${habitsCompleted}/${habitsTotal}` : '0/0',
      },
      budget: {
        spent: Math.round(totalSpent),
        limit: Math.round(totalLimit),
        remaining: Math.round(Math.max(0, totalLimit - totalSpent)),
        dailyBudget: daysRemaining > 0 ? Math.round((totalLimit - totalSpent) / daysRemaining) : 0,
        overBudgetCategories,
      },
      pet: pet
        ? {
            health: Math.round(pet.health),
            happiness: Math.round(pet.happiness),
            level: pet.level,
            isAlive: pet.isAlive,
          }
        : null,
      streak,
      steps: stepLog?.steps ?? 0,
      dayProgress:
        tasksTotal + habitsTotal > 0
          ? Math.round(((tasksCompleted + habitsCompleted) / (tasksTotal + habitsTotal)) * 100)
          : 0,
    };
  });

  // GET /briefing/evening — вечерний обзор
  app.get('/briefing/evening', async (request) => {
    const userId = request.userId;
    const today = getToday();

    const [tasks, habits, habitLogs, expenses, pet] = await Promise.all([
      prisma.task.findMany({
        where: { userId, date: today },
        select: { id: true, title: true, completed: true, category: true },
      }),
      prisma.habit.findMany({
        where: { userId, active: true },
        select: { id: true, name: true },
      }),
      prisma.habitLog.findMany({
        where: { userId, date: today, completed: true },
        select: { habitId: true },
      }),
      prisma.expense.findMany({
        where: { userId, date: today },
        select: { amount: true, category: true, description: true },
      }),
      prisma.pet.findFirst({
        where: { userId },
        select: { health: true, streak: true, level: true, xp: true },
      }),
    ]);

    const completedHabitIds = new Set(habitLogs.map((l) => l.habitId));
    const habitsCompleted = habits.filter((h) => completedHabitIds.has(h.id)).length;
    const tasksCompleted = tasks.filter((t) => t.completed).length;
    const totalItems = tasks.length + habits.length;
    const completedItems = tasksCompleted + habitsCompleted;
    const dayProgress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    const unfinishedTasks = tasks.filter((t) => !t.completed).map((t) => t.title);
    const unfinishedHabits = habits
      .filter((h) => !completedHabitIds.has(h.id))
      .map((h) => h.name);

    const totalSpentToday = expenses.reduce((sum, e) => sum + e.amount, 0);

    // Tone based on progress
    let tone: 'amazing' | 'good' | 'average' | 'bad';
    if (dayProgress >= 90) tone = 'amazing';
    else if (dayProgress >= 70) tone = 'good';
    else if (dayProgress >= 40) tone = 'average';
    else tone = 'bad';

    return {
      date: today.toISOString().split('T')[0],
      dayProgress,
      tone,
      tasks: {
        completed: tasksCompleted,
        total: tasks.length,
        unfinished: unfinishedTasks,
      },
      habits: {
        completed: habitsCompleted,
        total: habits.length,
        unfinished: unfinishedHabits,
      },
      spending: {
        today: Math.round(totalSpentToday),
        topExpenses: expenses
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 3)
          .map((e) => ({ amount: Math.round(e.amount), description: e.description })),
      },
      pet: pet
        ? { health: Math.round(pet.health), streak: pet.streak, level: pet.level, xp: pet.xp }
        : null,
      streak: pet?.streak ?? 0,
    };
  });
}
