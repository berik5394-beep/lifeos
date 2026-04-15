import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const createDocSchema = z.object({
  type: z.string(),
  title: z.string(),
  data: z.record(z.unknown()),
  imageUri: z.string().optional(),
  expiresAt: z.string().optional(),
});

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/documents', async (request, reply) => {
    const docs = await prisma.documentVault.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(docs);
  });

  app.get('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await prisma.documentVault.findFirst({ where: { id, userId: request.userId } });
    if (!doc) return reply.status(404).send({ message: 'Документ не найден' });
    return reply.send(doc);
  });

  app.post('/documents', async (request, reply) => {
    const body = createDocSchema.parse(request.body);
    const doc = await prisma.documentVault.create({
      data: {
        userId: request.userId,
        type: body.type,
        title: body.title,
        data: body.data as Prisma.InputJsonValue,
        imageUri: body.imageUri ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return reply.send(doc);
  });

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await prisma.documentVault.findFirst({ where: { id, userId: request.userId } });
    if (!doc) return reply.status(404).send({ message: 'Документ не найден' });
    await prisma.documentVault.delete({ where: { id } });
    return reply.send({ success: true });
  });

  app.get('/documents/expiring', async (request, reply) => {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const docs = await prisma.documentVault.findMany({
      where: {
        userId: request.userId,
        expiresAt: { lte: thirtyDaysFromNow, gte: new Date() },
      },
      orderBy: { expiresAt: 'asc' },
    });
    return reply.send(docs);
  });
}
