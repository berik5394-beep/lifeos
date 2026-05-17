import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getToolCounts } from '../services/tool-audit.js';

/**
 * SSOT migration Step 1 — источник правды для бейджей.
 * Мобилка читает «+N в задачи» ОТСЮДА (факт вызовов из ToolCall),
 * а не из текста ответа Claude. NLP-подсчёт в captureInBackground
 * выпиливается на Шаге 7.
 */

const querySchema = z.object({
  // ISO 8601 или относительное окно: 30s / 5m / 2h / 1d
  since: z.string().max(40).optional(),
});

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseSince(raw: string | undefined): Date {
  if (!raw) return new Date(Date.now() - DEFAULT_WINDOW_MS);
  const rel = raw.match(/^(\d+)([smhd])$/);
  if (rel) {
    const n = Number(rel[1]);
    const mult: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() - n * mult[rel[2]]);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? new Date(Date.now() - DEFAULT_WINDOW_MS)
    : d;
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/audit/counts', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    const since = parseSince(
      parsed.success ? parsed.data.since : undefined,
    );
    const counts = await getToolCounts(request.userId, since);
    return reply.send({ since: since.toISOString(), counts });
  });
}
