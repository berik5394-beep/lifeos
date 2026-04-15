import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/security.js';
import {
  analyzeLife,
  analyzeFinancialTruth,
  analyzeHealthTruth,
  analyzeQuickTruth,
} from '../services/life-truth-analyzer.js';
import { NotFoundError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Rate-limiters для AI-роутов. analyzeLife и analyzeQuickTruth зовут Claude
// Sonnet 4 — каждый вызов стоит реальных денег. Без лимита один юзер (или
// кривой клиент с ретраями) может спалить месячный бюджет за час.
// Лимитеры висят per-user (см. security.ts rateLimiter → userId-ключи).
// ---------------------------------------------------------------------------
const aiFullLimiter = rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'ai:life-full' });
const aiQuickLimiter = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'ai:life-quick' });

// ---------------------------------------------------------------------------
// Хелпер: конвертирует легаси-ошибку "Пользователь не найден" из сервиса
// в типизированный NotFoundError. Все остальные ошибки (Prisma/Anthropic/сеть)
// всплывают наверх и ловятся глобальным registerErrorHandler — больше не нужно
// дублировать один и тот же try/catch в каждом роуте.
// ---------------------------------------------------------------------------
async function runAnalysis<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message === 'Пользователь не найден') {
      throw new NotFoundError('Пользователь');
    }
    throw err;
  }
}

export async function lifeAnalysisRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Full life truth analysis (finances + health + progress + AI summary)
  app.post('/ai/life-analysis', { preHandler: aiFullLimiter }, async (request) => {
    return runAnalysis(() => analyzeLife(request.userId));
  });

  // Financial truth only (no AI call — fast)
  app.get('/ai/life-analysis/financial', async (request) => {
    const financial = await runAnalysis(() => analyzeFinancialTruth(request.userId));
    return { financial };
  });

  // Health truth only (no AI call — fast)
  app.get('/ai/life-analysis/health', async (request) => {
    const health = await runAnalysis(() => analyzeHealthTruth(request.userId));
    return { health };
  });

  // Quick daily truth — shorter AI summary for dashboard
  app.get('/ai/life-analysis/quick', { preHandler: aiQuickLimiter }, async (request) => {
    return runAnalysis(() => analyzeQuickTruth(request.userId));
  });
}
