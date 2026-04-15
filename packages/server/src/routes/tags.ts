import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const createTagSchema = z.object({
  name: z.string().min(1, 'Название тега обязательно'),
  color: z.string().optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
});

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /tags — list user's tags
  app.get('/tags', async (request) => {
    return prisma.tag.findMany({
      where: { userId: request.userId },
      include: { taskTags: { select: { taskId: true } } },
      orderBy: { createdAt: 'asc' },
    });
  });

  // POST /tags — create tag
  app.post('/tags', {
    preHandler: validate(createTagSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof createTagSchema>;
    const tag = await prisma.tag.create({
      data: {
        name: data.name,
        color: data.color ?? '#6366f1',
        userId: request.userId,
      },
    });
    return reply.status(201).send(tag);
  });

  // PUT /tags/:id — update tag
  app.put('/tags/:id', {
    preHandler: validate(updateTagSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as z.infer<typeof updateTagSchema>;

    const tag = await prisma.tag.findFirst({
      where: { id, userId: request.userId },
    });
    if (!tag) {
      return reply.status(404).send({ message: 'Тег не найден' });
    }

    const updated = await prisma.tag.update({
      where: { id },
      data,
    });
    return reply.send(updated);
  });

  // DELETE /tags/:id — delete tag (cascade removes TaskTag)
  app.delete('/tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const tag = await prisma.tag.findFirst({
      where: { id, userId: request.userId },
    });
    if (!tag) {
      return reply.status(404).send({ message: 'Тег не найден' });
    }

    await prisma.tag.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // POST /tags/:tagId/tasks/:taskId — attach tag to task
  app.post('/tags/:tagId/tasks/:taskId', async (request, reply) => {
    const { tagId, taskId } = request.params as { tagId: string; taskId: string };

    const tag = await prisma.tag.findFirst({
      where: { id: tagId, userId: request.userId },
    });
    if (!tag) {
      return reply.status(404).send({ message: 'Тег не найден' });
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: request.userId },
    });
    if (!task) {
      return reply.status(404).send({ message: 'Задача не найдена' });
    }

    const taskTag = await prisma.taskTag.create({
      data: { tagId, taskId },
    });
    return reply.status(201).send(taskTag);
  });

  // DELETE /tags/:tagId/tasks/:taskId — detach tag from task
  app.delete('/tags/:tagId/tasks/:taskId', async (request, reply) => {
    const { tagId, taskId } = request.params as { tagId: string; taskId: string };

    const taskTag = await prisma.taskTag.findFirst({
      where: { tagId, taskId },
    });
    if (!taskTag) {
      return reply.status(404).send({ message: 'Связь тег-задача не найдена' });
    }

    // Verify ownership via tag
    const tag = await prisma.tag.findFirst({
      where: { id: tagId, userId: request.userId },
    });
    if (!tag) {
      return reply.status(404).send({ message: 'Тег не найден' });
    }

    await prisma.taskTag.delete({ where: { id: taskTag.id } });
    return reply.send({ success: true });
  });
}
