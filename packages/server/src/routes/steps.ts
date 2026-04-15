import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate, parseDate, invalidDateReply } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';

// POST /steps — педометр на клиенте шлёт upsert раз в несколько минут.
// Даже при частых синках 30/мин с запасом. gpsTrack может быть до 5000 точек
// и ~500KB — тем более не стоит принимать это 60 раз в минуту.
const stepsLimiter = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'steps:upsert' });

// ---------------------------------------------------------------------------
// СХЕМЫ. КРИТИЧНО: до этого gpsTrack был без лимита — клиент мог прислать
// миллион точек, которые упаковываются в JSONB и живут в БД + десериализуются
// в память на каждом GET /steps?week=. 5000 точек = ~85 минут пробежки при
// частоте раз в секунду, с запасом. На телефоне такая дорожка занимает ~500KB
// в JSON — терпимо.
//
// date: до этого была голая z.string() → new Date(data.date) на битой строке
// давал Invalid Date, upsert падал с непонятной ошибкой Prisma. Добавил regex.
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата должна быть в формате YYYY-MM-DD');

const MAX_GPS_POINTS = 5000;
const MAX_STEPS_PER_DAY = 200_000; // мировой рекорд ~125k шагов/сутки

const upsertStepSchema = z.object({
  date: isoDate,
  steps: z.number().int().min(0).max(MAX_STEPS_PER_DAY),
  distanceKm: z.number().min(0).max(1000).nullable().optional(),
  gpsTrack: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        timestamp: z.number().int().min(0),
      }),
    )
    .max(MAX_GPS_POINTS)
    .nullable()
    .optional(),
});

export async function stepRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/steps', async (request, reply) => {
    const { date, week } = request.query as { date?: string; week?: string };

    if (date) {
      const parsed = parseDate(date);
      if (!parsed) return invalidDateReply(reply, 'date', 'YYYY-MM-DD');
      const log = await prisma.stepLog.findUnique({
        where: { userId_date: { userId: request.userId, date: parsed } },
      });
      return log ?? { steps: 0, distanceKm: null, gpsTrack: null };
    }

    if (week) {
      const weekStart = parseDate(week);
      if (!weekStart) return invalidDateReply(reply, 'week', 'YYYY-MM-DD');
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
    preHandler: [stepsLimiter, validate(upsertStepSchema)],
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof upsertStepSchema>;
    // После isoDate-regex гарантируем, что дата парсится. UTC-полночь —
    // чтобы уникальный ключ userId+date не плавал по часовым поясам.
    const dateObj = new Date(data.date + 'T00:00:00Z');

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
