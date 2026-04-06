import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';

const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  name: z.string().min(2, 'Имя слишком короткое'),
  password: z.string().min(6, 'Пароль минимум 6 символов'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

function generateTokens(app: FastifyInstance, userId: string) {
  const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: '15m' });
  const refreshToken = app.jwt.sign({ sub: userId, type: 'refresh' }, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', {
    preHandler: validate(registerSchema),
  }, async (request, reply) => {
    const { email, name, password } = request.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ message: 'Email уже зарегистрирован' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    const tokens = generateTokens(app, user.id);
    return reply.status(201).send({
      user: { id: user.id, email: user.email, name: user.name, currency: user.currency },
      ...tokens,
    });
  });

  app.post('/auth/login', {
    preHandler: validate(loginSchema),
  }, async (request, reply) => {
    const { email, password } = request.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ message: 'Неверный email или пароль' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ message: 'Неверный email или пароль' });
    }

    const tokens = generateTokens(app, user.id);
    return reply.send({
      user: { id: user.id, email: user.email, name: user.name, currency: user.currency },
      ...tokens,
    });
  });

  app.post('/auth/refresh', {
    preHandler: validate(refreshSchema),
  }, async (request, reply) => {
    const { refreshToken } = request.body as z.infer<typeof refreshSchema>;

    try {
      const decoded = app.jwt.verify<{ sub: string; type: string }>(refreshToken);
      if (decoded.type !== 'refresh') {
        return reply.status(401).send({ message: 'Неверный токен' });
      }

      const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
      if (!user) {
        return reply.status(401).send({ message: 'Пользователь не найден' });
      }

      const tokens = generateTokens(app, user.id);
      return reply.send(tokens);
    } catch {
      return reply.status(401).send({ message: 'Токен истёк или неверен' });
    }
  });
}
