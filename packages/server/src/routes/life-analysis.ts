import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  analyzeLife,
  analyzeFinancialTruth,
  analyzeHealthTruth,
  analyzeQuickTruth,
} from '../services/life-truth-analyzer.js';

export async function lifeAnalysisRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Full life truth analysis (finances + health + progress + AI summary)
  app.post('/ai/life-analysis', async (request, reply) => {
    try {
      const result = await analyzeLife(request.userId);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Внутренняя ошибка';
      if (message === 'Пользователь не найден') {
        return reply.status(404).send({ message });
      }
      request.log.error(err, 'Life analysis failed');
      return reply.status(500).send({ message: 'Не удалось выполнить анализ' });
    }
  });

  // Financial truth only (no AI call — fast)
  app.get('/ai/life-analysis/financial', async (request, reply) => {
    try {
      const financial = await analyzeFinancialTruth(request.userId);
      return { financial };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Внутренняя ошибка';
      if (message === 'Пользователь не найден') {
        return reply.status(404).send({ message });
      }
      request.log.error(err, 'Financial analysis failed');
      return reply.status(500).send({ message: 'Не удалось выполнить анализ' });
    }
  });

  // Health truth only (no AI call — fast)
  app.get('/ai/life-analysis/health', async (request, reply) => {
    try {
      const health = await analyzeHealthTruth(request.userId);
      return { health };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Внутренняя ошибка';
      if (message === 'Пользователь не найден') {
        return reply.status(404).send({ message });
      }
      request.log.error(err, 'Health analysis failed');
      return reply.status(500).send({ message: 'Не удалось выполнить анализ' });
    }
  });

  // Quick daily truth — shorter AI summary for dashboard
  app.get('/ai/life-analysis/quick', async (request, reply) => {
    try {
      const result = await analyzeQuickTruth(request.userId);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Внутренняя ошибка';
      if (message === 'Пользователь не найден') {
        return reply.status(404).send({ message });
      }
      request.log.error(err, 'Quick analysis failed');
      return reply.status(500).send({ message: 'Не удалось выполнить анализ' });
    }
  });
}
