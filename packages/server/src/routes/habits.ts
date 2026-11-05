import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseMonth, invalidDateReply } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import { captureActivity } from '../services/tool-activity-summary.js';

// POST /habits/:id/log. Нормальный
// юзер за минуту отмечает максимум 10-20 привычек, даже на полном свайп-списке.
// 60/мин оставляем запас на мульти-отметки и голосовые команды «отметь всё».
const logLimiter = rateLimiter({ max: 60, windowMs: 60_000, keyPrefix: 'habits:log' });

const createHabitSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  category: z.string(),
  frequency: z.string(),
  goalId: z.string().nullable().optional(),
  autoComplete: z.record(z.unknown()).nullable().optional(),
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
        autoComplete: (data.autoComplete ?? undefined) as Prisma.InputJsonValue | undefined,
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

    const updateData: Prisma.HabitUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.order !== undefined) updateData.order = data.order;
    if (data.goalId !== undefined) updateData.goalId = data.goalId;
    if (data.autoComplete !== undefined) {
      updateData.autoComplete = (data.autoComplete ?? undefined) as Prisma.InputJsonValue | undefined;
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

    return habits.map((habit) => ({
      id: habit.id,
      name: habit.name,
      category: habit.category,
      completedDays: habit.logs.length,
      totalDays: Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    }));
  });
}
