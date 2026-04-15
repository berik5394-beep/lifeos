import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const addDependencySchema = z.object({
  prerequisiteTaskId: z.string().min(1, 'ID задачи-предшественника обязателен'),
});

export async function dependencyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /tasks/:id/dependencies — add prerequisite
  app.post('/tasks/:id/dependencies', {
    preHandler: validate(addDependencySchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { prerequisiteTaskId } = request.body as z.infer<typeof addDependencySchema>;

    // Verify both tasks belong to user
    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const prereq = await prisma.task.findFirst({
      where: { id: prerequisiteTaskId, userId: request.userId },
    });
    if (!prereq) {
      return reply.status(404).send({ message: 'Задача-предшественник не найдена' });
    }

    if (id === prerequisiteTaskId) {
      return reply.status(400).send({ message: 'Задача не может зависеть от самой себя' });
    }

    const dep = await prisma.taskDependency.create({
      data: {
        dependentTaskId: id,
        prerequisiteTaskId,
      },
    });
    return reply.status(201).send(dep);
  });

  // DELETE /tasks/:id/dependencies/:depId — remove dependency
  app.delete('/tasks/:id/dependencies/:depId', async (request, reply) => {
    const { id, depId } = request.params as { id: string; depId: string };

    // Verify task ownership
    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const dep = await prisma.taskDependency.findFirst({
      where: {
        id: depId,
        dependentTaskId: id,
      },
    });
    if (!dep) {
      return reply.status(404).send({ message: 'Зависимость не найдена' });
    }

    await prisma.taskDependency.delete({ where: { id: depId } });
    return reply.send({ success: true });
  });

  // GET /tasks/:id/dependencies — list deps (both directions)
  app.get('/tasks/:id/dependencies', async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await prisma.task.findFirst({
      where: { id, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const [dependsOn, dependedBy] = await Promise.all([
      prisma.taskDependency.findMany({
        where: { dependentTaskId: id },
        include: { prerequisiteTask: { select: { id: true, title: true, completed: true } } },
      }),
      prisma.taskDependency.findMany({
        where: { prerequisiteTaskId: id },
        include: { dependentTask: { select: { id: true, title: true, completed: true } } },
      }),
    ]);

    return { dependsOn, dependedBy };
  });
}
