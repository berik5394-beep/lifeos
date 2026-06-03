import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import jwt from '@fastify/jwt';
import { registerErrorHandler } from '../../src/middleware/error-handler.js';

// Собираем настоящий Fastify из реальных роут-плагинов БЕЗ импорта index.ts
// (тот на верхнем уровне делает listen + запуск бота). Регистрируем только то,
// что нужно хендлерам: @fastify/jwt (тот же секрет) + error-handler (чтобы
// брошенный NotFoundError стал 404, а не 500). Глобальные cors/rate-limit
// намеренно опускаем — изолируем хендлеры.
export async function buildTestApp(
  plugins: FastifyPluginAsync[],
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  registerErrorHandler(app);
  for (const p of plugins) await app.register(p);
  await app.ready();
  return app;
}
