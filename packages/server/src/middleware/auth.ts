import type { FastifyRequest, FastifyReply } from 'fastify';

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
  } catch {
    return reply.status(401).send({ message: 'Неверный токен' });
  }
}
