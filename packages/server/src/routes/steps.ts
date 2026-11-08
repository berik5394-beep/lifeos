import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/**
 * Шаги из «Здоровья» iPhone (jarvis-roadmap / сборка №15): приложение само
 * присылает шаги за день. Таблица StepLog была, а принимать было некуда —
 * поэтому бриф, «Разбор» и портрет всегда видели «0 шагов».
 */
const stepsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD'),
  steps: z.number().int().min(0).max(200_000),
  distanceKm: z.number().min(0).max(500).nullable().optional(),
});

export async function stepsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Идемпотентно: тот же день — перезаписать (Здоровье досчитывает шаги за день).
  app.post('/steps', { preHandler: validate(stepsSchema) }, async (request) => {
    const d = request.body as z.infer<typeof stepsSchema>;
    const date = new Date(`${d.date}T00:00:00Z`);
    const row = await prisma.stepLog.upsert({
      where: { userId_date: { userId: request.userId, date } },
      create: { userId: request.userId, date, steps: d.steps, distanceKm: d.distanceKm ?? null },
      update: { steps: d.steps, ...(d.distanceKm != null ? { distanceKm: d.distanceKm } : {}) },
    });
    return { ok: true, date: d.date, steps: row.steps };
  });
}
