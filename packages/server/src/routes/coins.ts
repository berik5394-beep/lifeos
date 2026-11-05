import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { coinBalance, grantStartBonus } from '../services/coins.js';

/** Робот-эпик, Часть 6: монеты за дела — баланс и последние начисления. */
export async function coinRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/coins', async (request) => {
    const userId = request.userId;
    await grantStartBonus(userId); // подарок на новоселье — один раз
    const [balance, recent] = await Promise.all([
      coinBalance(userId),
      prisma.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { amount: true, reason: true, createdAt: true },
      }),
    ]);
    return { balance, recent };
  });
}
