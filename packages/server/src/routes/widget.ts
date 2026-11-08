import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateOnlyUTC, localTimeStr } from '../lib/tz.js';

/**
 * Виджет «Сегодня» на главном экране iPhone (сборка №15+): одним запросом —
 * задачи и привычки на сегодня (сделано/всего), ближайшая встреча и главная
 * открытая задача. День и «сейчас» — по поясу пользователя.
 */
export interface WidgetToday {
  date: string;
  tasksDone: number;
  tasksTotal: number;
  habitsDone: number;
  habitsTotal: number;
  next: { time: string; title: string } | null;
  topTask: string | null;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function buildWidgetToday(userId: string, now: Date = new Date()): Promise<WidgetToday> {
  const tz = await getUserTimezone(userId);
  const today = localDateOnlyUTC(tz, now);
  const nowHHMM = localTimeStr(tz, now);
  const [tasks, habits, logs, events] = await Promise.all([
    prisma.task.findMany({
      where: { userId, date: today, cancelled: false },
      select: { title: true, completed: true, priority: true, time: true },
    }),
    prisma.habit.count({ where: { userId, active: true } }),
    prisma.habitLog.count({ where: { userId, date: today, completed: true, habit: { active: true } } }),
    prisma.calendarEvent.findMany({
      where: { userId, date: today, startTime: { not: null } },
      select: { title: true, startTime: true },
      orderBy: { startTime: 'asc' },
    }),
  ]);
  const next = events.find((e) => (e.startTime as string) >= nowHHMM);
  const open = tasks
    .filter((t) => !t.completed)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.time ?? '99').localeCompare(b.time ?? '99'));
  return {
    date: today.toISOString().slice(0, 10),
    tasksDone: tasks.filter((t) => t.completed).length,
    tasksTotal: tasks.length,
    habitsDone: Math.min(logs, habits),
    habitsTotal: habits,
    next: next ? { time: next.startTime as string, title: next.title } : null,
    topTask: open[0]?.title ?? null,
  };
}

export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);
  app.get('/widget/today', async (request) => buildWidgetToday(request.userId));
}
