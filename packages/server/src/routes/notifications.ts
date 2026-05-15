import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateProactiveNotifications } from '../services/proactive-notifications.js';

const registerTokenSchema = z.object({
  // Expo push token: ExponentPushToken[...] / ExpoPushToken[...]
  token: z
    .string()
    .regex(/^Expo(nent)?PushToken\[.+\]$/, 'Невалидный Expo push token')
    .max(256),
});

// ---------------------------------------------------------------------------
// Helper: today's date (midnight, no time component)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Motivational quotes (server-side fallback pool)
// ---------------------------------------------------------------------------
const QUOTES = [
  { text: 'Маленькие шаги каждый день ведут к большим результатам', author: 'Неизвестный' },
  { text: 'Дисциплина — это мост между целями и достижениями', author: 'Джим Рон' },
  { text: 'Не жди идеального момента — создай его', author: 'Джордж Бернард Шоу' },
  { text: 'Успех — это сумма маленьких усилий, повторяемых день за днём', author: 'Роберт Кольер' },
  { text: 'Единственный способ сделать великую работу — любить то, что делаешь', author: 'Стив Джобс' },
  { text: 'Начни с того места, где стоишь', author: 'Артур Эш' },
  { text: 'Каждый день делай то, что боишься', author: 'Элеонора Рузвельт' },
  { text: 'Будущее зависит от того, что ты делаешь сегодня', author: 'Махатма Ганди' },
  { text: 'Лучшее время посадить дерево было 20 лет назад. Второе лучшее — сейчас', author: 'Китайская пословица' },
  { text: 'Ты не обязан быть великим, чтобы начать', author: 'Зиг Зиглар' },
];

function getDailyQuote(date: Date): { text: string; author: string } {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000,
  );
  return QUOTES[dayOfYear % QUOTES.length];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /**
   * GET /notifications/briefing
   *
   * Returns a compact briefing for the mobile notification system:
   * - today's tasks (id, title, date, time, completed)
   * - today's events (id, title, date, startTime)
   * - habits progress string ("3/8")
   * - streak (consecutive days)
   * - daily quote
   * - budget status (spent, limit, remaining)
   */
  app.get('/notifications/briefing', async (request) => {
    const userId = request.userId;
    const today = getToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { start: monthStart, end: monthEnd } = getMonthRange();

    const [tasks, events, habits, habitLogs, expenses, budgetLimits, pet] =
      await Promise.all([
        prisma.task.findMany({
          where: { userId, date: today },
          orderBy: [{ time: 'asc' }],
          select: {
            id: true,
            title: true,
            date: true,
            time: true,
            completed: true,
            category: true,
            priority: true,
          },
        }),

        prisma.calendarEvent.findMany({
          where: { userId, date: today },
          orderBy: { startTime: 'asc' },
          select: {
            id: true,
            title: true,
            date: true,
            startTime: true,
            endTime: true,
            location: true,
          },
        }),

        prisma.habit.findMany({
          where: { userId, active: true },
          select: { id: true },
        }),

        prisma.habitLog.findMany({
          where: { userId, date: today, completed: true },
          select: { habitId: true },
        }),

        prisma.expense.findMany({
          where: {
            userId,
            date: { gte: monthStart, lte: monthEnd },
          },
          select: { amount: true },
        }),

        prisma.budgetLimit.findMany({
          where: {
            userId,
            month: today.getMonth() + 1,
            year: today.getFullYear(),
          },
          select: { monthlyLimit: true },
        }),

        prisma.pet.findFirst({
          where: { userId },
          select: { streak: true },
        }),
      ]);

    // Habits progress
    const completedHabits = habitLogs.length;
    const totalHabits = habits.length;
    const habitsProgress = `${completedHabits}/${totalHabits}`;

    // Streak — use pet streak if available, otherwise 0
    const streak = pet?.streak ?? 0;

    // Budget
    const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalLimit = budgetLimits.reduce((sum, b) => sum + b.monthlyLimit, 0);

    // Quote
    const quote = getDailyQuote(new Date());

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        date: t.date.toISOString().split('T')[0],
        time: t.time,
        completed: t.completed,
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date.toISOString().split('T')[0],
        startTime: e.startTime,
      })),
      habitsProgress,
      streak,
      quote,
      budgetStatus: {
        spent: Math.round(totalSpent),
        limit: Math.round(totalLimit),
        remaining: Math.round(Math.max(0, totalLimit - totalSpent)),
      },
    };
  });

  /**
   * GET /notifications/proactive
   *
   * Generates smart push notifications for the authenticated user:
   * - Event reminders (1h and 30min before)
   * - Budget alerts (80%+ of category limit)
   * - Habit nudges (afternoon, incomplete habits)
   * - Inactivity ping (no activity by noon)
   * - Weekly summary (Sunday evening)
   */
  app.get('/notifications/proactive', async (request) => {
    const userId = request.userId;
    const notifications = await generateProactiveNotifications(userId);

    return {
      notifications: notifications.map((n) => ({
        title: n.title,
        body: n.body,
        type: n.type,
        scheduledFor: n.scheduledFor.toISOString(),
      })),
      count: notifications.length,
      generatedAt: new Date().toISOString(),
    };
  });

  /**
   * POST /notifications/register-token
   * Мобильное приложение регистрирует свой Expo push token при старте.
   * Это primary-канал проактивных уведомлений (app-first).
   */
  app.post(
    '/notifications/register-token',
    { preHandler: validate(registerTokenSchema) },
    async (request, reply) => {
      const { token } = request.body as z.infer<typeof registerTokenSchema>;
      await prisma.user.update({
        where: { id: request.userId },
        data: { expoPushToken: token },
      });
      return reply.send({ ok: true });
    },
  );

  /**
   * DELETE /notifications/register-token
   * Отписка (logout / выключил уведомления) — чистим токен.
   */
  app.delete('/notifications/register-token', async (request, reply) => {
    await prisma.user.update({
      where: { id: request.userId },
      data: { expoPushToken: null },
    });
    return reply.send({ ok: true });
  });
}
