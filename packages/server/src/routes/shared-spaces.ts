import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const createSpaceSchema = z.object({
  name: z.string().min(1, 'Название пространства обязательно'),
});

const addMemberSchema = z.object({
  email: z.string().email('Некорректный email'),
});

export async function sharedSpaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /shared-spaces — create space
  app.post('/shared-spaces', {
    preHandler: validate(createSpaceSchema),
  }, async (request, reply) => {
    const { name } = request.body as z.infer<typeof createSpaceSchema>;

    const space = await prisma.sharedSpace.create({
      data: {
        name,
        ownerId: request.userId,
        members: {
          create: {
            userId: request.userId,
            role: 'owner',
          },
        },
      },
      include: { members: true },
    });
    return reply.status(201).send(space);
  });

  // GET /shared-spaces — list user's spaces (owned + member)
  app.get('/shared-spaces', async (request) => {
    const memberships = await prisma.sharedSpaceMember.findMany({
      where: { userId: request.userId },
      include: {
        sharedSpace: {
          include: {
            _count: { select: { members: true, tasks: true } },
          },
        },
      },
    });

    return memberships.map((m) => ({
      ...m.sharedSpace,
      role: m.role,
      memberCount: m.sharedSpace._count.members,
      taskCount: m.sharedSpace._count.tasks,
    }));
  });

  // GET /shared-spaces/:id — detail with members + task count
  app.get('/shared-spaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verify membership
    const membership = await prisma.sharedSpaceMember.findFirst({
      where: { sharedSpaceId: id, userId: request.userId },
    });
    if (!membership) {
      return reply.status(404).send({ message: 'Пространство не найдено' });
    }

    const space = await prisma.sharedSpace.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        _count: { select: { tasks: true } },
      },
    });

    return space;
  });

  // POST /shared-spaces/:id/members — add member by email
  app.post('/shared-spaces/:id/members', {
    preHandler: validate(addMemberSchema),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { email } = request.body as z.infer<typeof addMemberSchema>;

    // Only owner can add members
    const space = await prisma.sharedSpace.findFirst({
      where: { id, ownerId: request.userId },
    });
    if (!space) {
      return reply.status(403).send({ message: 'Только владелец может добавлять участников' });
    }

    const userToAdd = await prisma.user.findUnique({ where: { email } });
    if (!userToAdd) {
      return reply.status(404).send({ message: 'Пользователь с таким email не найден' });
    }

    const member = await prisma.sharedSpaceMember.create({
      data: {
        sharedSpaceId: id,
        userId: userToAdd.id,
        role: 'member',
      },
    });
    return reply.status(201).send(member);
  });

  // DELETE /shared-spaces/:id/members/:userId — remove member
  app.delete('/shared-spaces/:id/members/:userId', async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };

    // Only owner can remove members (and cannot remove self)
    const space = await prisma.sharedSpace.findFirst({
      where: { id, ownerId: request.userId },
    });
    if (!space) {
      return reply.status(403).send({ message: 'Только владелец может удалять участников' });
    }

    if (userId === request.userId) {
      return reply.status(400).send({ message: 'Владелец не может удалить себя' });
    }

    const membership = await prisma.sharedSpaceMember.findFirst({
      where: { sharedSpaceId: id, userId },
    });
    if (!membership) {
      return reply.status(404).send({ message: 'Участник не найден' });
    }

    await prisma.sharedSpaceMember.delete({ where: { id: membership.id } });
    return reply.send({ success: true });
  });

  // GET /shared-spaces/:id/tasks — tasks in space
  app.get('/shared-spaces/:id/tasks', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verify membership
    const membership = await prisma.sharedSpaceMember.findFirst({
      where: { sharedSpaceId: id, userId: request.userId },
    });
    if (!membership) {
      return reply.status(404).send({ message: 'Пространство не найдено' });
    }

    const tasks = await prisma.task.findMany({
      where: { sharedSpaceId: id },
      include: {
        taskTags: { include: { tag: true } },
        subtasks: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    return tasks;
  });
}
