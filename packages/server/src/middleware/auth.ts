import type { FastifyRequest, FastifyReply } from 'fastify';
import { captureTimezone } from './tz-capture.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ message: 'Токен не предоставлен' });
    }

    const decoded = request.server.jwt.verify<{ sub: string; type?: string }>(token);
    // Refresh-токен (30 дней, тот же секрет) — только для /auth/refresh. Раньше он
    // проходил как обычный: отозванный (logout, reuse-тревога) жил ещё 30 дней.
    if (decoded.type === 'refresh') {
      return reply.status(401).send({ message: 'Неверный токен' });
    }
    request.userId = decoded.sub;
    // Real-Time Foundation: зафиксировать настоящий пояс устройства из заголовка
    // X-Timezone. Fire-and-forget, best-effort — НИКОГДА не влияет на auth.
    void captureTimezone(decoded.sub, request.headers['x-timezone']);
  } catch {
    return reply.status(401).send({ message: 'Неверный токен' });
  }
}
