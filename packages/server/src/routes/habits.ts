import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseMonth, invalidDateReply } from '../middleware/validate.js';

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

const logHabitSchema = z.object({
  date: z.string(),
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
    return reply.send({ success: true });
  });

  app.post('/habits/:id/log', {
    preHandler: validate(logHabitSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date, completed } = request.body as z.infer<typeof logHabitSchema>;

    const habit = await prisma.habit.findFirst({
      where: { id, userId: request.userId },
    });
    if (!habit) {
      return reply.status(404).send({ message: 'Привычка не найдена' });
    }

    const log = await prisma.habitLog.upsert({
      where: { habitId_date: { habitId: id, date: new Date(date) } },
      create: {
        habitId: id,
        userId: request.userId,
        date: new Date(date),
        completed,
      },
      update: { completed },
    });

    // Award mana when completing a habit
    if (completed) {
      const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
      if (pet) {
        const manaGain = 5; // +5 mana per completed habit
        await prisma.pet.update({
          where: { userId: request.userId },
          data: { mana: Math.min(pet.maxMana, pet.mana + manaGain) },
        });
      }
    }

    return reply.send(log);
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
