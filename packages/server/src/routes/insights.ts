import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/security.js';
import { generateInsights } from '../services/proactive-insights.js';

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
}
