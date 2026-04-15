import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter, validatePassword, getClientIp } from '../middleware/security.js';

const registerSchema = z.object({
  email: z.string().email('Некорректный email').max(254),
  name: z.string().min(2, 'Имя слишком короткое').max(100),
  password: z.string().min(8, 'Пароль минимум 8 символов').max(128),
  assistantGender: z.enum(['male', 'female']).optional(),
  wakeUpTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат HH:MM').optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(2048),
});

const profileUpdateSchema = z.object({
  name: z.string().min(2, 'Имя слишком короткое').max(100).optional(),
  assistantStyle: z.enum(['friendly', 'strict', 'calm', 'toxic']).optional(),
  assistantGender: z.enum(['male', 'female']).optional(),
  wakeUpTime: z.string().regex(/^\d{2}:\d{2}$/, 'Формат HH:MM').optional(),
  currency: z.string().max(8).optional(),
});

// ============================================================================
// Утилиты для refresh-токенов
// ============================================================================

const REFRESH_TOKEN_TTL_DAYS = 30;
// БЕЗОПАСНОСТЬ: короткий TTL access-токена + ротация refresh-токенов.
// Если access-токен утечёт — окно атаки максимум 30 минут (вместо 7 дней).
// Клиент в apps/mobile/services/api.ts уже умеет авто-рефреш на 401.
const ACCESS_TOKEN_TTL = '30m';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Создаёт новый refresh-токен и сохраняет его HASH в БД.
 * Возвращает сам токен (его получает клиент) — в БД хранится только хэш.
 */
async function createRefreshToken(
  app: FastifyInstance,
  userId: string,
  request: FastifyRequest,
  replacedBy?: string,
): Promise<string> {
  // Сам JWT-токен — для совместимости с клиентским кодом, который ждёт JWT
  const token = app.jwt.sign(
    { sub: userId, type: 'refresh', jti: crypto.randomUUID() },
    { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` },
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      replacedBy: replacedBy ?? null,
      ip: getClientIp(request),
      userAgent: String(request.headers['user-agent'] ?? '').slice(0, 500),
    },
  });

  return token;
}

/**
 * Отзывает все refresh-токены пользователя.
 * Используется при выходе или при подозрении на компрометацию.
 */
async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  });
}

// ============================================================================
// Routes
// ============================================================================

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Rate limiters: жёсткие лимиты для логина/регистрации (защита от brute-force)
  const loginLimiter = rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'login' });
  const registerLimiter = rateLimiter({ max: 3, windowMs: 60_000, keyPrefix: 'register' });
  const refreshLimiter = rateLimiter({ max: 30, windowMs: 60_000, keyPrefix: 'refresh' });

  // ----- REGISTER ----------------------------------------------------------
  app.post('/auth/register', {
    preHandler: [registerLimiter, validate(registerSchema)],
  }, async (request, reply) => {
    const { email, name, password, assistantGender, wakeUpTime } =
      request.body as z.infer<typeof registerSchema>;

    // Усиленная валидация пароля
    const passCheck = validatePassword(password);
    if (!passCheck.valid) {
      return reply.status(400).send({ message: (passCheck as { valid: false; reason: string }).reason });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return reply.status(409).send({ message: 'Email уже зарегистрирован' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        ...(assistantGender ? { assistantGender } : {}),
        ...(wakeUpTime ? { wakeUpTime } : {}),
      },
    });

    const accessToken = generateAccessToken(app, user.id);
    const refreshToken = await createRefreshToken(app, user.id, request);

    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        currency: user.currency,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      },
      accessToken,
      refreshToken,
    });
  });

  // ----- LOGIN -------------------------------------------------------------
  app.post('/auth/login', {
    preHandler: [loginLimiter, validate(loginSchema)],
  }, async (request, reply) => {
    const { email, password } = request.body as z.infer<typeof loginSchema>;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // ВАЖНО: одинаковое сообщение для "не найден" и "пароль неверен" —
    // защита от user enumeration. Также делаем фейковую bcrypt-проверку
    // в случае отсутствия пользователя — защита от timing-атак.
    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
      return reply.status(401).send({ message: 'Неверный email или пароль' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ message: 'Неверный email или пароль' });
    }

    const accessToken = generateAccessToken(app, user.id);
    const refreshToken = await createRefreshToken(app, user.id, request);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        currency: user.currency,
        assistantGender: user.assistantGender,
        wakeUpTime: user.wakeUpTime,
      },
      accessToken,
      refreshToken,
    });
  });

  // ----- REFRESH (с ротацией) ----------------------------------------------
  app.post('/auth/refresh', {
    preHandler: [refreshLimiter, validate(refreshSchema)],
  }, async (request, reply) => {
    const { refreshToken } = request.body as z.infer<typeof refreshSchema>;

    let decoded: { sub: string; type: string };
    try {
      decoded = app.jwt.verify<{ sub: string; type: string }>(refreshToken);
    } catch {
      return reply.status(401).send({ message: 'Токен истёк или неверен' });
    }

    if (decoded.type !== 'refresh') {
      return reply.status(401).send({ message: 'Неверный токен' });
    }

    // Проверяем, что токен есть в БД и не отозван
    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      // Токен подписан правильно, но в БД его нет — попытка использовать поддельный
      // или устаревший токен после миграции. Безопасно отказать.
      return reply.status(401).send({ message: 'Токен не найден' });
    }

    if (stored.revoked) {
      // 🚨 ВНИМАНИЕ: использован уже отозванный токен.
      // Это означает: либо токен утёк и им пользуется злоумышленник,
      // либо рассинхрон клиента. В любом случае — отозвать ВСЕ токены пользователя.
      // Это заставит пользователя залогиниться заново, но защитит данные.
      app.log.warn(
        `🚨 Использован отозванный refresh-token для user ${stored.userId}. Отзываем все токены.`,
      );
      await revokeAllUserTokens(stored.userId);
      return reply.status(401).send({
        message: 'Подозрительная активность. Войдите заново.',
      });
    }

    if (stored.expiresAt < new Date()) {
      return reply.status(401).send({ message: 'Токен истёк' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      return reply.status(401).send({ message: 'Пользователь не найден' });
    }

    // Ротация: создаём новый refresh, отзываем старый
    const newRefreshToken = await createRefreshToken(app, user.id, request);
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { revoked: true, replacedBy: hashToken(newRefreshToken) },
    });

    const accessToken = generateAccessToken(app, user.id);
    return reply.send({ accessToken, refreshToken: newRefreshToken });
  });

  // ----- LOGOUT ------------------------------------------------------------
  // Отзывает текущий refresh-токен (или все, если передан флаг)
  app.post('/auth/logout', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const userId = request.userId;
    await revokeAllUserTokens(userId);
    return reply.send({ ok: true });
  });

  // ----- DELETE ACCOUNT ----------------------------------------------------
  const deleteAccountSchema = z.object({
    password: z.string().min(1, 'Пароль обязателен'),
  });

  app.post('/auth/delete-account', {
    preHandler: [authMiddleware, validate(deleteAccountSchema)],
  }, async (request, reply) => {
    const userId = request.userId;
    const { password } = request.body as z.infer<typeof deleteAccountSchema>;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ message: 'Пользователь не найден' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ message: 'Неверный пароль' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.deleteMany({ where: { userId } });
      await tx.habitLog.deleteMany({ where: { userId } });
      await tx.habit.deleteMany({ where: { userId } });
      await tx.task.deleteMany({ where: { userId } });
      await tx.weeklyGoal.deleteMany({ where: { userId } });
      await tx.yearlyGoal.deleteMany({ where: { userId } });
      await tx.expense.deleteMany({ where: { userId } });
      await tx.income.deleteMany({ where: { userId } });
      await tx.journalEntry.deleteMany({ where: { userId } });
      await tx.stepLog.deleteMany({ where: { userId } });
      await tx.importedFile.deleteMany({ where: { userId } });
      await tx.calendarEvent.deleteMany({ where: { userId } });
      await tx.budgetLimit.deleteMany({ where: { userId } });
      await tx.integration.deleteMany({ where: { userId } });
      await tx.achievement.deleteMany({ where: { userId } });
      await tx.pet.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    return reply.send({ message: 'Аккаунт удалён' });
  });

  // ----- CHANGE PASSWORD ----------------------------------------------------
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Текущий пароль обязателен'),
    newPassword: z.string().min(8, 'Минимум 8 символов'),
  });

  const changePasswordLimiter = rateLimiter({ max: 3, windowMs: 60_000, keyPrefix: 'change-password' });

  app.post('/auth/change-password', {
    preHandler: [changePasswordLimiter, authMiddleware, validate(changePasswordSchema)],
  }, async (request, reply) => {
    const userId = request.userId;
    const { currentPassword, newPassword } = request.body as z.infer<typeof changePasswordSchema>;

    // Validate new password strength
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return reply.status(400).send({ message: (passwordCheck as { valid: false; reason: string }).reason });
    }

    // Verify current password
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ message: 'Пользователь не найден' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ message: 'Неверный текущий пароль' });
    }

    // Prevent reusing the same password
    const samePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (samePassword) {
      return reply.status(400).send({ message: 'Новый пароль должен отличаться от текущего' });
    }

    // Update password hash
    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Revoke all refresh tokens — force re-login on other devices
    await revokeAllUserTokens(userId);

    // Issue new tokens for current session
    const accessToken = generateAccessToken(app, userId);
    const refreshToken = await createRefreshToken(app, userId, request);

    return reply.send({
      message: 'Пароль успешно изменён',
      accessToken,
      refreshToken,
    });
  });

  // ----- PROFILE UPDATE ----------------------------------------------------
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
