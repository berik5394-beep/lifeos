/**
 * R9 helper — extract `user.timezone` через прямой Prisma запрос.
 *
 * Зачем отдельный module: lib/tz.ts намеренно pure (без prisma)
 * — там только Intl/Date вычисления. Этот файл соединяет user
 * data + tz helpers в одну точку. 8 tools (R9 TZ pass) ранее
 * inline'ом делали `prisma.user.findUnique({select:{timezone:true}})`
 * + fallback на 'UTC' — теперь один helper.
 *
 * Кэш не делаем (низкий load, чтение прозрачно для Prisma pool).
 * Если будет hot path — добавим request-level memoization без
 * изменения API.
 */

import { prisma } from './prisma.js';

/**
 * Возвращает IANA-timezone юзера (e.g. 'Asia/Almaty') или 'UTC'
 * если юзер не найден / поле пустое. НИКОГДА не throws — friend-UX
 * не должен ломаться от proklёма с DB lookup.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone || 'UTC';
  } catch (err) {
    console.warn(
      '[user-context] getUserTimezone failed, fallback UTC:',
      err instanceof Error ? err.message : err,
    );
    return 'UTC';
  }
}
