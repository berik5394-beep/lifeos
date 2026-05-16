import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import { generateInsights } from '../services/proactive-insights.js';

const dismissSchema = z.object({
  dismissKey: z.string().min(1).max(128),
});

// Insights — детерминированный анализ БД, не AI. Дёшево, но всё равно делает
// ~8 параллельных запросов к Postgres. 30 вызовов в минуту с запасом для UI
// (юзер не обновляет дашборд 60 раз в минуту).
const insightsLimiter = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'insights' });

export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /insights — массив проактивных подсказок для дашборда / утреннего пуша.
  // Юзер видит "Серика откладываешь 3 дня", "бюджет на еду на исходе" и т.д.
  app.get('/insights', { preHandler: insightsLimiter }, async (request) => {
    const insights = await generateInsights(request.userId);
    return { insights, generatedAt: new Date().toISOString() };
  });

  // POST /insights/dismiss — юзер смахнул подсказку. Append-only лог;
  // generateInsights за 14-дневное окно сам понизит/заглушит часто
  // смахиваемое (Phase 4.4). critical полностью не глушится.
  app.post(
    '/insights/dismiss',
    { preHandler: [insightsLimiter, validate(dismissSchema)] },
    async (request, reply) => {
      const { dismissKey } = request.body as z.infer<typeof dismissSchema>;
      await prisma.insightDismissal.create({
        data: { userId: request.userId, dismissKey },
      });
      return reply.send({ success: true });
    },
  );
}
