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

    const decoded = request.server.jwt.verify<{ sub: string }>(token);
    request.userId = decoded.sub;
    // Real-Time Foundation: зафиксировать настоящий пояс устройства из заголовка
    // X-Timezone. Fire-and-forget, best-effort — НИКОГДА не влияет на auth.
    void captureTimezone(decoded.sub, request.headers['x-timezone']);
  } catch {
    return reply.status(401).send({ message: 'Неверный токен' });
  }
}
