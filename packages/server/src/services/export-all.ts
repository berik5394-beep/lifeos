import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * «Скачать все мои данные» (GDPR ст. 20, 2026-11-10). Раньше выгружались только
 * финансы/привычки/задачи в CSV. Здесь — каждая таблица, где есть поле userId
 * (список берётся из схемы Prisma: новая таблица попадёт сама), плюс профиль.
 * Секреты не отдаём: таблицы токенов/кодов целиком, а поля с токенами/хешами — вырезаем.
 */
const SKIP_MODELS = new Set(['RefreshToken', 'PasswordResetCode']);
const SECRET_FIELD = /token|secret|hash|password|code$/i;

export function userOwnedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.name !== 'User' && !SKIP_MODELS.has(m.name) && m.fields.some((f) => f.name === 'userId' && f.kind === 'scalar'))
    .map((m) => m.name)
    .sort();
}

function stripSecrets<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!SECRET_FIELD.test(k)) out[k] = v;
  return out;
}

type Delegate = { findMany: (args: { where: { userId: string } }) => Promise<Record<string, unknown>[]> };

export async function exportAllUserData(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('user not found');
  const data: Record<string, unknown[]> = {};
  for (const model of userOwnedModels()) {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const delegate = (prisma as unknown as Record<string, Delegate | undefined>)[key];
    if (!delegate?.findMany) continue;
    const rows = await delegate.findMany({ where: { userId } });
    if (rows.length > 0) data[model] = rows.map(stripSecrets);
  }
  return {
    exportedAt: new Date().toISOString(),
    format: 'LifeOS full export v1',
    profile: stripSecrets(user as unknown as Record<string, unknown>),
    data,
  };
}
