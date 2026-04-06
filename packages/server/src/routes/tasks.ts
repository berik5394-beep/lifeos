import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const createTaskSchema = z.object({
  title: z.string().min(1, 'Название обязательно'),
  category: z.string(),
  priority: z.string(),
  date: z.string(),
  time: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  completed: z.boolean().optional(),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/tasks', async (request) => {
    const { date, week } = request.query as { date?: string; week?: string };

    if (week) {
      const weekStart = new Date(week);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: { gte: weekStart, lt: weekEnd },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
    }

    if (date) {
      return prisma.task.findMany({
        where: {
          userId: request.userId,
          date: new Date(date),
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    return prisma.task.findMany({
      where: { userId: request.userId },
      orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    });
  });

  app.post('/tasks', {
    preHandler: validate(createTaskSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createTaskSchema>;
    const task = await prisma.task.create({
      data: {
        ...data,
        date: new Date(data.date),
        userId: request.userId,
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
    return reply.send(updated);
  });
}
