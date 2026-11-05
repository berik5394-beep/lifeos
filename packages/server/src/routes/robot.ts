import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter, aiDailyLimiter } from '../middleware/security.js';
import { EXPLAIN_PANELS, explainPanel } from '../services/robot-explain.js';

/**
 * Робот-эпик, Часть 5: робот достал инструмент из мебели — объясняет, что там
 * важного (по фактам из БД, без выдумок). В историю чата не пишется.
 */
const explainSchema = z.object({ panel: z.enum(EXPLAIN_PANELS) });
const explainRateLimit = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'robot-explain' });

export async function robotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post(
    '/robot/explain',
    { preHandler: [explainRateLimit, aiDailyLimiter, validate(explainSchema)] },
    async (request) => {
      const { panel } = request.body as z.infer<typeof explainSchema>;
      return explainPanel(request.userId, panel);
    },
  );
}
