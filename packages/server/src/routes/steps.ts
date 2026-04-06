import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const upsertStepSchema = z.object({
  date: z.string(),
  steps: z.number().int().min(0),
  distanceKm: z.number().min(0).nullable().optional(),
  gpsTrack: z.array(z.object({
    latitude: z.number(),
    longitude: z.number(),
    timestamp: z.number(),
  })).nullable().optional(),
});

export async function stepRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/steps', async (request) => {
    const { date, week } = request.query as { date?: string; week?: string };

    if (date) {
      const log = await prisma.stepLog.findUnique({
        where: { userId_date: { userId: request.userId, date: new Date(date) } },
      });
      return log ?? { steps: 0, distanceKm: null, gpsTrack: null };
    }

    if (week) {
      const weekStart = new Date(week);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      return prisma.stepLog.findMany({
        where: {
          userId: request.userId,
          date: { gte: weekStart, lt: weekEnd },
        },
        orderBy: { date: 'asc' },
      });
    }

    return prisma.stepLog.findMany({
      where: { userId: request.userId },
      orderBy: { date: 'desc' },
      take: 30,
    });
  });

  app.post('/steps', {
    preHandler: validate(upsertStepSchema),
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof upsertStepSchema>;
    const dateObj = new Date(data.date);

    const log = await prisma.stepLog.upsert({
      where: { userId_date: { userId: request.userId, date: dateObj } },
      create: {
        userId: request.userId,
        date: dateObj,
        steps: data.steps,
        distanceKm: data.distanceKm ?? null,
        gpsTrack: (data.gpsTrack as Prisma.InputJsonValue) ?? undefined,
      },
      update: {
        steps: data.steps,
        distanceKm: data.distanceKm ?? undefined,
        gpsTrack: (data.gpsTrack as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return reply.send(log);
  });
}
