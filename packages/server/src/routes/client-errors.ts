import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rateLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { reportClientCrash } from '../lib/ops-alert.js';

/**
 * POST /client-errors — сбой приложения у пользователя (2026-11-10). Раньше
 * ошибки экрана и необработанные JS-исключения писались только в консоль
 * телефона: в проде мы о них не узнавали. Теперь — строка в логе Railway
 * ([client-crash]) и пуш получателям ops-алертов (OPS_ALERT_EMAILS).
 * Без входа тоже (сбой мог случиться до логина); тексты задач/сообщений не шлём —
 * только текст ошибки, стек и экран.
 */
const schema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(4000).optional(),
  route: z.string().max(80).optional(),
  fatal: z.boolean().optional(),
  platform: z.string().max(20).optional(),
  appVersion: z.string().max(40).optional(),
  updateId: z.string().max(80).optional(),
});

export async function clientErrorRoutes(app: FastifyInstance): Promise<void> {
  const limiter = rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'client-errors' });
  app.post('/client-errors', { preHandler: [limiter, validate(schema)] }, async (request, reply) => {
    const body = request.body as z.infer<typeof schema>;
    let userId = 'anon';
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        userId = request.server.jwt.verify<{ sub: string }>(auth.slice(7)).sub;
      } catch {
        // протухший токен — всё равно сохраняем сбой
      }
    }
    const firstFrame = (body.stack ?? '').split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
    console.error(
      `[client-crash] user=${userId} ${body.platform ?? '?'} v=${body.appVersion ?? '?'} upd=${body.updateId ?? '?'} ` +
        `route=${body.route ?? '?'} fatal=${body.fatal === true} msg=${JSON.stringify(body.message)} ${firstFrame.trim()}`,
    );
    reportClientCrash(body.message, body.route ?? '');
    return reply.status(204).send();
  });
}
