import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';

const quickAddSchema = z.object({
  text: z.string().min(1, 'Текст обязателен'),
});

const anthropic = new Anthropic();

const quickAddRateLimit = rateLimiter({ max: 15, windowMs: 60_000, keyPrefix: 'quick-add' });

export async function quickAddRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /tasks/quick-add — parse natural language text into task fields
  app.post('/tasks/quick-add', {
    preHandler: [quickAddRateLimit, aiDailyLimiter, validate(quickAddSchema)],
  }, async (request, reply) => {
    const { text } = request.body as z.infer<typeof quickAddSchema>;

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const systemPrompt = `Ты — парсер задач для приложения LifeOS. Пользователь вводит текст на русском, ты извлекаешь структурированные данные задачи.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "title": "string — название задачи",
  "date": "YYYY-MM-DD — дата задачи (если не указана, используй ${today})",
  "time": "HH:MM или null — время задачи",
  "category": "work|personal|health|finance|education|home — категория",
  "priority": "low|medium|high|critical — приоритет",
  "estimatedMinutes": "number или null — оценка времени в минутах",
  "confidence": "0.0-1.0 — уверенность в парсинге"
}

Правила:
- Если категория неочевидна, ставь "personal"
- Если приоритет неочевиден, ставь "medium"
- "срочно", "важно", "ASAP" → high/critical
- "когда-нибудь", "без спешки" → low
- Определяй время из контекста: "утром" → "09:00", "в обед" → "13:00", "вечером" → "19:00"`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: text }],
        system: systemPrompt,
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return reply.status(500).send({ message: 'Не удалось распарсить текст' });
      }

      const parsed = JSON.parse(content.text) as {
        title: string;
        date: string;
        time: string | null;
        category: string;
        priority: string;
        estimatedMinutes: number | null;
        confidence: number;
      };

      // Create the task in DB
      const task = await prisma.task.create({
        data: {
          title: parsed.title,
          date: new Date(parsed.date),
          time: parsed.time,
          category: parsed.category,
          priority: parsed.priority,
          estimatedMinutes: parsed.estimatedMinutes,
          userId: request.userId,
        },
      });

      return reply.status(201).send({
        task,
        parsed,
        confidence: parsed.confidence,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка парсинга';
      return reply.status(500).send({ message: `Не удалось распарсить текст: ${message}` });
    }
  });
}
