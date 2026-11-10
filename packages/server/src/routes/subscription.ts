import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * GET /subscription — статус подписки юзера для мобильного
 * subscription-store (4.4: раньше роута не было → 404 → экран подписки
 * падал в release). Биллинг ещё не подключён (IAP/Stripe) — отдаём
 * реальный tier из User (по умолчанию 'free'), чтобы экран не врал и не
 * крашился. Когда подключим покупки — этот же роут начнёт отдавать 'pro'.
 */
/** Подписок нет: все функции открыты каждому. Единый переключатель на будущее. */
export const FREE_FOR_ALL = true;

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/subscription', async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    });
    // Одна версия для всех (Berik 2026-11-10): подписок нет, полная версия у каждого.
    // Появится платный уровень — FREE_FOR_ALL=false, и tier снова берётся из User.
    const tier = FREE_FOR_ALL || user?.subscriptionTier === 'pro' ? 'pro' : 'free';
    return reply.send({
      tier,
      freeForAll: FREE_FOR_ALL,
      expiresAt: user?.subscriptionExpiresAt
        ? user.subscriptionExpiresAt.toISOString()
        : null,
    });
  });
}
