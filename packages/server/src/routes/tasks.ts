import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, parseMonth, invalidDateReply } from '../middleware/validate.js';

const createTaskSchema = z.object({
  title: z.string().min(1, 'Название обязательно'),
  category: z.string(),
  priority: z.string(),
  date: z.string(),
  time: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  kanbanStatus: z.string().optional(),
  parentId: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  recurrence: z.string().nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  completed: z.boolean().optional(),
});

const kanbanStatusSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done']),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/tasks', async (request, reply) => {
    const { date, week, month } = request.query as { date?: string; week?: string; month?: string };

    if (week) {
      const weekStart = parseDate(week);
      if (!weekStart) return invalidDateReply(reply, 'week', 'YYYY-MM-DD');
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: weekStart, lt: weekEnd },
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
    }

    if (date) {
      const parsed = parseDate(date);
      if (!parsed) return invalidDateReply(reply, 'date', 'YYYY-MM-DD');
      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: parsed,
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (month) {
      const range = parseMonth(month);
      if (!range) return invalidDateReply(reply, 'month', 'YYYY-MM');

      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: range.start, lt: range.end },
        },
        include: {
          taskTags: { include: { tag: true } },
          subtasks: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
    }

    return prisma.task.findMany({
      where: { userId: request.userId },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
    });
  });

  app.post('/tasks', {
    preHandler: validate(createTaskSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createTaskSchema>;
    const task = await prisma.task.create({
      data: {
        title: data.title,
        category: data.category,
        priority: data.priority,
        date: new Date(data.date),
        time: data.time ?? null,
        notes: data.notes ?? null,
        kanbanStatus: data.kanbanStatus ?? 'todo',
        parentId: data.parentId ?? null,
        estimatedMinutes: data.estimatedMinutes ?? null,
        recurrence: data.recurrence ?? null,
        userId: request.userId,
      },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
    });
    return reply.status(201).send(task);
  });

  app.put('/tasks/:id', {
    preHandler: validate(updateTaskSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateTaskSchema>;

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
    });
    return reply.send(updated);
  });

  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    await prisma.task.delete({ where: { id } });
    return reply.send({ success: true });
  });

  app.patch('/tasks/:id/complete', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { completed: !task.completed },
    });

    // Award mana when completing a task (not when uncompleting)
    if (!task.completed) {
      const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
      if (pet) {
        const manaGain = 10; // +10 mana per completed task
        await prisma.pet.update({
          where: { userId: request.userId },
          data: { mana: Math.min(pet.maxMana, pet.mana + manaGain) },
        });
      }
    }

    return reply.send(updated);
  });

  // PATCH /tasks/:id/kanban — update kanban status
  app.patch('/tasks/:id/kanban', {
    preHandler: validate(kanbanStatusSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as z.infer<typeof kanbanStatusSchema>;

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        kanbanStatus: status,
        completed: status === 'done',
      },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
      },
    });

    // Award mana when moving to done (same as complete)
    if (status === 'done' && !task.completed) {
      const pet = await prisma.pet.findUnique({ where: { userId: request.userId } });
      if (pet) {
        const manaGain = 10;
        await prisma.pet.update({
          where: { userId: request.userId },
          data: { mana: Math.min(pet.maxMana, pet.mana + manaGain) },
        });
      }
    }

    return reply.send(updated);
  });
}
