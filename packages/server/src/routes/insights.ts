import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/security.js';
import { generateInsights } from '../services/proactive-insights.js';
import { activeRowsForFeed } from '../services/insight-store.js';
import { joinFeed, tableOnlyFeed } from '../services/insight-core.js';

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
  // R5.4 гибрид: generateInsights считает payload + персистит lifecycle
  // (R5.3). Членство фида решает Insight-таблица (activeScopeKeys =
  // SSOT: не superseded/dismissed/expired), UI-payload — из compute по
  // scopeKey. Пустой Set (персист упал, НЕ-фатальный) → joinFeed
  // отдаёт computed (резильентно, не прячем всё из-за сбоя стора).
  app.get('/insights', { preHandler: insightsLimiter }, async (request) => {
    const computed = await generateInsights(request.userId);
    const rows = await activeRowsForFeed(request.userId);
    // R5.4 гибрид: плоские — payload из compute (членство по lifecycle
    // стора); P3.b.5: ряды БЕЗ compute-близнеца (рефлектор) —
    // из СВОЕГО honest payload. Резильентность joinFeed: пустой
    // keys → computed как есть (персист упал).
    const keys = new Set(rows.map((r) => r.scopeKey));
    const flat = joinFeed(computed, keys);
    const reflector = tableOnlyFeed(
      rows,
      new Set(computed.map((c) => c.id)),
    );
    const insights = [...flat, ...reflector];
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
