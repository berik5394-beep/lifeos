import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseMonth, invalidDateReply } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import { captureActivity } from '../services/tool-activity-summary.js';
import { onHabitDone } from '../services/coins.js';
import { habitAutoCompleteSchema } from '../services/habit-auto.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

// POST /habits/:id/log. Нормальный юзер за минуту отмечает максимум 10-20
// привычек, даже на полном свайп-списке.
// 60/мин оставляем запас на мульти-отметки и голосовые команды «отметь всё».
const logLimiter = rateLimiter({ max: 60, windowMs: 60_000, keyPrefix: 'habits:log' });

const createHabitSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  category: z.string(),
  frequency: z.string(),
  goalId: z.string().nullable().optional(),
  // Строго { type:'steps', min } или null (раньше — любой JSON; null не очищал).
  autoComplete: habitAutoCompleteSchema.nullable().optional(),
});

const updateHabitSchema = createHabitSchema.partial().extend({
  active: z.boolean().optional(),
  order: z.number().optional(),
});

// isoDate regex — раньше была голая z.string() и new Date(date) на мусоре
// молча давал Invalid Date, что потом взрывалось на уровне Prisma.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата должна быть в формате YYYY-MM-DD');

const logHabitSchema = z.object({
  date: isoDate,
  completed: z.boolean(),
});

/** Самая длинная серия подряд идущих дней (даты @db.Date, UTC-полночь). */
/**
 * Текущая серия: подряд до сегодня (или до вчера — сегодня ещё не отмечено).
 * Аудит 2026-11-09: «🔥 N дн.» показывал самую длинную серию МЕСЯЦА — пропустил
 * вчера, а огонёк всё ещё «10 дн.»; 1-го числа падал до 0–1.
 */
export function currentRun(dates: Date[], todayStartMs: number): number {
  const days = new Set(dates.map((d) => Math.round(d.getTime() / 86_400_000)));
  let day = Math.round(todayStartMs / 86_400_000);
  if (!days.has(day)) day -= 1;
  let run = 0;
  while (days.has(day)) {
    run++;
    day--;
  }
  return run;
}

export function longestRun(dates: Date[]): number {
  const days = [...new Set(dates.map((d) => Math.round(d.getTime() / 86_400_000)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Цель принадлежит юзеру (для goalId привычки). */
async function ownsGoal(userId: string, goalId: string): Promise<boolean> {
  return (await prisma.yearlyGoal.count({ where: { id: goalId, userId } })) > 0;
}

export async function habitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/habits', async (request) => {
    return prisma.habit.findMany({
      where: { userId: request.userId, active: true },
      orderBy: { order: 'asc' },
    });
  });

  app.post('/habits', {
    preHandler: validate(createHabitSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createHabitSchema>;
    // IDOR: goalId раньше писался без проверки владельца — привычку можно было
    // привязать к ЧУЖОЙ цели (и детекторы показали бы её текст).
    if (data.goalId && !(await ownsGoal(request.userId, data.goalId))) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    const maxOrder = await prisma.habit.aggregate({
      where: { userId: request.userId },
      _max: { order: true },
    });

    const habit = await prisma.habit.create({
      data: {
        name: data.name,
        category: data.category,
        frequency: data.frequency,
        goalId: data.goalId ?? undefined,
        autoComplete: data.autoComplete ? (data.autoComplete as Prisma.InputJsonValue) : undefined,
        userId: request.userId,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
    captureActivity(request.userId, {
      type: 'habit_created',
      content: `Новая привычка «${habit.name}»`,
    });
    return reply.status(201).send(habit);
  });

  app.put('/habits/:id', {
    preHandler: validate(updateHabitSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateHabitSchema>;

    const habit = await prisma.habit.findFirst({
      where: { id, userId: request.userId },
    });
    if (!habit) {
      return reply.status(404).send({ message: 'Привычка не найдена' });
    }
    if (data.goalId && !(await ownsGoal(request.userId, data.goalId))) {
      return reply.status(404).send({ message: 'Цель не найдена' });
    }

    const updateData: Prisma.HabitUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.order !== undefined) updateData.order = data.order;
    if (data.goalId !== undefined) updateData.goalId = data.goalId;
    if (data.autoComplete !== undefined) {
      // null — выключить (раньше null превращался в undefined и не очищал).
      updateData.autoComplete = data.autoComplete === null ? Prisma.DbNull : (data.autoComplete as Prisma.InputJsonValue);
    }

    const updated = await prisma.habit.update({
      where: { id },
      data: updateData,
    });
    captureActivity(request.userId, {
      type: 'habit_updated',
      content: `Изменил привычку «${updated.name}»`,
    });
    return reply.send(updated);
  });

  app.delete('/habits/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const habit = await prisma.habit.findFirst({
      where: { id, userId: request.userId },
    });
    if (!habit) {
      return reply.status(404).send({ message: 'Привычка не найдена' });
    }

    await prisma.habit.update({
      where: { id },
      data: { active: false },
    });
    captureActivity(request.userId, {
      type: 'habit_deleted',
      content: `Убрал привычку «${habit.name}»`,
    });
    return reply.send({ success: true });
  });

  app.post('/habits/:id/log', {
    preHandler: [logLimiter, validate(logHabitSchema)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date, completed } = request.body as z.infer<typeof logHabitSchema>;

    const habit = await prisma.habit.findFirst({
      where: { id, userId: request.userId },
    });
    if (!habit) {
      return reply.status(404).send({ message: 'Привычка не найдена' });
    }

    const dateObj = new Date(date + 'T00:00:00Z');

    const log = await prisma.habitLog.upsert({
      where: { habitId_date: { habitId: id, date: dateObj } },
      create: {
        habitId: id,
        userId: request.userId,
        date: dateObj,
        completed,
      },
      update: { completed },
    });

    if (completed) void onHabitDone(request.userId, id, date, habit.name);
    captureActivity(request.userId, {
      type: 'habit_logged',
      content: completed
        ? `Отметил привычку «${habit.name}»`
        : `Снял отметку с привычки «${habit.name}»`,
    });
    return reply.send(log);
  });

  // habit-day (2026-11-05): приложение подтягивает отметки с сервера, а не только
  // из локального стора — иначе голосовые/чатовые отметки (через мозг) и отметки
  // с другого устройства не видны, а после переустановки история пропадает.
  // date = календарная дата юзера 'YYYY-MM-DD' (та же конвенция, что пишет POST /log).
  app.get('/habits/logs', async (request, reply) => {
    const parsed = z
      .object({ from: isoDate, to: isoDate })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'from/to — даты в формате YYYY-MM-DD' });
    }
    const from = new Date(parsed.data.from + 'T00:00:00Z');
    const to = new Date(parsed.data.to + 'T00:00:00Z');
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (!Number.isFinite(days) || days < 0 || days > 62) {
      return reply.status(400).send({ message: 'Диапазон — от 0 до 62 дней' });
    }
    const logs = await prisma.habitLog.findMany({
      where: { userId: request.userId, date: { gte: from, lte: to } },
      select: { id: true, habitId: true, date: true, completed: true },
      orderBy: { date: 'asc' },
    });
    return logs.map((l) => ({ ...l, date: l.date.toISOString().slice(0, 10) }));
  });

  app.get('/habits/stats/:month', async (request, reply) => {
    const { month } = request.params as { month: string };
    const range = parseMonth(month);
    if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');
    const { start, end } = range;

    const habits = await prisma.habit.findMany({
      where: { userId: request.userId, active: true },
      include: {
        logs: {
          where: {
            date: { gte: start, lt: end },
            completed: true,
          },
        },
      },
    });

    const DAY = 86_400_000;
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / DAY);
    // Прошедшие дни месяца (текущий — по сегодня включительно по поясу юзера):
    // «За месяц %» раньше делилось на все дни месяца и в начале месяца было провальным.
    const todayCivil = localDateStr(await getUserTimezone(request.userId), new Date());
    const todayStart = new Date(`${todayCivil}T00:00:00Z`).getTime();
    const elapsed = Math.max(0, Math.min(totalDays, Math.floor((todayStart - start.getTime()) / DAY) + 1));
    // Текущая серия — по логам за год, а не за месяц.
    const yearLogs = await prisma.habitLog.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, completed: true, date: { gte: new Date(todayStart - 366 * DAY), lte: new Date(todayStart) } },
      select: { habitId: true, date: true },
    });
    const byHabit = new Map<string, Date[]>();
    for (const l of yearLogs) byHabit.set(l.habitId, [...(byHabit.get(l.habitId) ?? []), l.date]);
    return habits.map((habit) => {
      const completed = habit.logs.length;
      // «За месяц %» — с дня, когда привычку завели (заведённая 20-го не «провальная»).
      // Отметки задним числом раньше даты заведения — считаем с первой из них.
      const firstLog = habit.logs.reduce((m, l) => Math.min(m, l.date.getTime()), Infinity);
      const created = Math.min(new Date(`${habit.createdAt.toISOString().slice(0, 10)}T00:00:00Z`).getTime(), firstLog);
      const sinceCreated = created > start.getTime() ? Math.max(1, Math.floor((todayStart - created) / DAY) + 1) : elapsed;
      const total = Math.min(elapsed, sinceCreated);
      return {
        // Поля, которые читает приложение (раньше их не было → «NaN» на экране привычек).
        habitId: habit.id,
        habitName: habit.name,
        completed,
        total,
        streak: currentRun(byHabit.get(habit.id) ?? [], todayStart),
        bestInMonth: longestRun(habit.logs.map((l) => l.date)),
        // Прежние поля — для совместимости.
        id: habit.id,
        name: habit.name,
        category: habit.category,
        completedDays: completed,
        totalDays,
      };
    });
  });
}
