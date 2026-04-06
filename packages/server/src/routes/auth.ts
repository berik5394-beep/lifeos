import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';

const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  name: z.string().min(2, 'Имя слишком короткое'),
  password: z.string().min(6, 'Пароль минимум 6 символов'),
  assistantGender: z.enum(['male', 'female']).optional(),
  wakeUpTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат HH:MM').optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const profileUpdateSchema = z.object({
  name: z.string().min(2, 'Имя слишком короткое').optional(),
  assistantStyle: z.enum(['friendly', 'strict', 'calm', 'toxic']).optional(),
  assistantGender: z.enum(['male', 'female']).optional(),
  wakeUpTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат HH:MM').optional(),
  currency: z.string().optional(),
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
    const { email, name, password, assistantGender, wakeUpTime } = request.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ message: 'Email уже зарегистрирован' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        ...(assistantGender ? { assistantGender } : {}),
        ...(wakeUpTime ? { wakeUpTime } : {}),
      },
    });

    const tokens = generateTokens(app, user.id);
    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        currency: user.currency,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      },
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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        currency: user.currency,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      },
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

  app.patch('/auth/profile', {
    preHandler: [authMiddleware, validate(profileUpdateSchema)],
  }, async (request, reply) => {
    const userId = request.userId;
    const body = request.body as z.infer<typeof profileUpdateSchema>;

    const dataToUpdate: Record<string, string> = {};
    if (body.name !== undefined) dataToUpdate.name = body.name;
    if (body.assistantStyle !== undefined) dataToUpdate.assistantStyle = body.assistantStyle;
    if (body.assistantGender !== undefined) dataToUpdate.assistantGender = body.assistantGender;
    if (body.wakeUpTime !== undefined) dataToUpdate.wakeUpTime = body.wakeUpTime;
    if (body.currency !== undefined) dataToUpdate.currency = body.currency;

    if (Object.keys(dataToUpdate).length === 0) {
      return reply.status(400).send({ message: 'Нет данных для обновления' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        name: true,
        currency: true,
        assistantStyle: true,
        assistantGender: true,
        wakeUpTime: true,
      },
    });

    return reply.send({ user });
  });
}
