import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  runReflector,
  runReflectorDaily,
} from '../services/reflector-service.js';

/**
 * P3 verification affordance (запрошено Бериком). Дёргает УЖЕ
 * протестированный путь рефлектора руками — чтобы убедиться e2e в
 * проде без ожидания тика scheduler'а (1/день) и без живых юзеров.
 *
 * БЕЗОПАСНОСТЬ:
 *  - secret-gated (header x-admin-secret == process.env.ADMIN_SECRET),
 *    timing-safe сравнение;
 *  - ADMIN_SECRET НЕ задан → эндпоинт ОТКЛЮЧЁН (404, не намёк);
 *  - НЕТ деструктивных операций: только runReflector(Daily) +
 *    read обратно. Insight-строки идут через тот же selectInsights
 *    (R9/R10/dedup) — повторный вызов идемпотентен (cooldown), не
 *    плодит дубли.
 */
function secretOk(header: unknown): boolean {
  const want = process.env.ADMIN_SECRET;
  if (!want || want.length < 16) return false; // слабый/пустой → выкл
  if (typeof header !== 'string' || header.length === 0) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const bodySchema = z.object({
  userId: z.string().min(1).max(64),
  // force: обойти каденс-гейт 1/день (для повторной верификации).
  force: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/reflector/run', async (request, reply) => {
    if (!secretOk(request.headers['x-admin-secret'])) {
      return reply.code(404).send({ error: 'not found' });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad body' });
    }
    const { userId, force } = parsed.data;
    const now = new Date();

    const result = force
      ? { ran: true, ...(await runReflector(userId, now)) }
      : await runReflectorDaily(userId, now);

    // Что реально лежит в ЕДИНОМ сторе (активные reflector-ряды).
    const insights = await prisma.insight.findMany({
      where: { userId, source: 'reflector', supersededAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        scopeKey: true,
        severity: true,
        message: true,
        deliveredAt: true,
        dismissed: true,
        createdAt: true,
      },
    });
    return { ...result, activeReflectorInsights: insights };
  });
}
