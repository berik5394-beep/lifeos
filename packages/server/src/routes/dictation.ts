import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { processDictation } from '../services/dictation-service.js';

// Диктофон — самая дорогая фича: Whisper STT + Claude extraction. Жёсткий cap.
const dictationRateLimit = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'dictation' });

// Аудио до ~7MB raw (10MB base64). Поверх есть bodyLimit на роуте.
const processSchema = z.object({
  audio: z.string().min(1, 'Audio data обязателен').max(15_000_000),
  format: z.string().max(8).default('m4a'),
  durationSeconds: z.number().int().nonnegative().optional(),
});

const memoryListSchema = z.object({
  type: z.string().max(32).optional(),
  tag: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const memoryCreateSchema = z.object({
  type: z.enum(['fact', 'decision', 'event', 'person', 'place', 'preference', 'emotion']),
  content: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
  tags: z.array(z.string().max(32)).max(10).default([]),
  importance: z.number().int().min(1).max(10).default(5),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function dictationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /dictation/process — главная фича: диктофон → задачи + память.
  // Принимает base64 аудио, возвращает извлечённое + сохраняет в БД.
  app.post(
    '/dictation/process',
    {
      bodyLimit: 20 * 1024 * 1024, // 20MB — base64 аудио до ~14MB raw
      preHandler: [dictationRateLimit, aiDailyLimiter, validate(processSchema)],
    },
    async (request, reply) => {
      const { audio, format, durationSeconds } = request.body as z.infer<typeof processSchema>;
      // Вся логика в переиспользуемом сервисе — тот же код использует
      // Telegram-бот для голосовых сообщений.
      const result = await processDictation(
        request.userId,
        audio,
        format,
        durationSeconds,
      );
      return reply.send(result);
    },
  );

  // GET /dictation/history — последние сессии
  app.get('/dictation/history', async (request) => {
    const sessions = await prisma.dictationSession.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return sessions;
  });

  // GET /memory — список воспоминаний с фильтрами
  app.get('/memory', { preHandler: validate(memoryListSchema, 'query') }, async (request) => {
    const { type, tag, limit } = request.query as z.infer<typeof memoryListSchema>;
    const now = new Date();
    const memories = await prisma.memory.findMany({
      where: {
        userId: request.userId,
        ...(type ? { type } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return memories;
  });

  // POST /memory — добавить вручную (например из чата или кнопки)
  app.post('/memory', { preHandler: validate(memoryCreateSchema) }, async (request, reply) => {
    const data = request.body as z.infer<typeof memoryCreateSchema>;
    const memory = await prisma.memory.create({
      data: {
        userId: request.userId,
        type: data.type,
        content: data.content,
        details: data.details ?? null,
        source: 'manual',
        tags: data.tags,
        importance: data.importance,
        expiresAt: data.expiresAt ? new Date(data.expiresAt + 'T00:00:00Z') : null,
      },
    });
    return reply.status(201).send(memory);
  });

  // DELETE /memory/:id
  app.delete('/memory/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await prisma.memory.deleteMany({
      where: { id, userId: request.userId },
    });
    if (deleted.count === 0) {
      return reply.status(404).send({ message: 'Воспоминание не найдено' });
    }
    return reply.send({ ok: true });
  });

  // POST /memory/search — текстовый поиск (Фаза 2 заменит на vector search).
  // Сейчас — простой case-insensitive LIKE по content+details+tags.
  app.post(
    '/memory/search',
    { preHandler: [aiDailyLimiter, validate(searchSchema)] },
    async (request) => {
      const { query, limit } = request.body as z.infer<typeof searchSchema>;
      const now = new Date();
      const memories = await prisma.memory.findMany({
        where: {
          userId: request.userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [
            {
              OR: [
                { content: { contains: query, mode: 'insensitive' } },
                { details: { contains: query, mode: 'insensitive' } },
                { tags: { has: query.toLowerCase() } },
              ],
            },
          ],
        },
        orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
      return memories;
    },
  );
}
