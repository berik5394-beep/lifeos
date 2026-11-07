/**
 * «Забыли пароль?» как у всех: код из 6 цифр на почту (и в Telegram, если он
 * подключён) → человек вводит код и новый пароль.
 *
 * Безопасность:
 * - в БД только HMAC кода (ключ — JWT_SECRET), не сам код;
 * - 15 минут жизни, до 5 попыток, новый запрос гасит старый код;
 * - не чаще раза в минуту на аккаунт (кнопку «прислать ещё» не заспамить);
 * - ответ на запрос одинаковый, есть аккаунт или нет (почты не перебрать);
 * - после смены пароля все сессии на других устройствах закрываются.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { validatePassword } from '../middleware/security.js';
import { getTelegramChatId } from './push-service.js';
import { sendTelegramTo } from './telegram-bot.js';

export const RESET_CODE_TTL_MS = 15 * 60_000;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_RESEND_MS = 60_000;

function hashCode(userId: string, code: string): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET ?? 'lifeos-reset').update(`${userId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export type ResetDelivery = { email: boolean; telegram: boolean };

/**
 * Выслать код. Возвращает, куда ушло (для логов и тестов — НЕ для ответа
 * клиенту: ответ всегда одинаковый). Нет аккаунта / слишком часто — никуда.
 */
export async function requestPasswordReset(
  rawEmail: string,
  deps: { genCode?: () => string; now?: Date } = {},
): Promise<ResetDelivery> {
  const none = { email: false, telegram: false };
  const email = rawEmail.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!user) return none;
  const now = deps.now ?? new Date();

  const last = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (last && now.getTime() - last.createdAt.getTime() < RESET_RESEND_MS) return none;

  const code = deps.genCode?.() ?? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction([
    // Старые неиспользованные коды больше не работают.
    prisma.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    prisma.passwordResetCode.create({
      data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS), createdAt: now },
    }),
  ]);

  const hello = user.name ? `${user.name.trim().split(/\s+/)[0]}, ` : '';
  const text =
    `${hello}код для сброса пароля LifeOS: ${code}\n\n` +
    'Он действует 15 минут. Если вы не просили сбросить пароль — просто проигнорируйте это сообщение, пароль останется прежним.';
  const [mailed, chatId] = await Promise.all([
    sendMail({ to: email, subject: `Код для сброса пароля: ${code}`, text }),
    getTelegramChatId(user.id).catch(() => null),
  ]);
  const telegram = chatId ? await sendTelegramTo(chatId, text).catch(() => false) : false;
  if (!mailed && !telegram) console.warn(`[password-reset] код не доставлен: нет почты (RESEND_API_KEY/MAIL_FROM) и Telegram (user=${user.id})`);
  return { email: mailed, telegram };
}

export class ResetError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Проверить код и поставить новый пароль. Ошибки — понятным текстом. */
export async function resetPassword(rawEmail: string, code: string, newPassword: string, now: Date = new Date()): Promise<void> {
  const email = rawEmail.toLowerCase().trim();
  const wrong = new ResetError(400, 'Неверный или устаревший код. Запросите новый.');
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  if (!user) throw wrong;

  const row = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw wrong;
  if (row.attempts >= RESET_MAX_ATTEMPTS) throw new ResetError(429, 'Слишком много попыток. Запросите новый код.');

  if (!sameHash(row.codeHash, hashCode(user.id, code.trim()))) {
    await prisma.passwordResetCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const left = RESET_MAX_ATTEMPTS - row.attempts - 1;
    throw new ResetError(400, left > 0 ? `Неверный код. Осталось попыток: ${left}.` : 'Слишком много попыток. Запросите новый код.');
  }

  const check = validatePassword(newPassword);
  if (!check.valid) throw new ResetError(400, (check as { valid: false; reason: string }).reason);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordResetCode.update({ where: { id: row.id }, data: { usedAt: now } }),
    // Все сессии на других устройствах — выход (вдруг пароль утёк).
    prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
  ]);
}
