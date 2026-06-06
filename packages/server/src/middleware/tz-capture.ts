import { prisma } from '../lib/prisma.js';
import { isValidIanaTz } from '../lib/tz.js';
import { isV2RealtimeEnabled } from '../lib/feature-flags.js';

/**
 * Real-Time Foundation — фиксация настоящего пояса устройства.
 *
 * userId → последний виденный пояс. Пишем в БД ТОЛЬКО на смену пояса
 * (in-memory cache) → нет write-storm на каждый запрос.
 *
 * ВАЖНО: captureTimezone — ЕДИНСТВЕННЫЙ писатель User.timezone. Если появится
 * ручная смена пояса (экран настроек) — инвалидировать/обходить этот кэш,
 * иначе stale-запись затенит ручное значение до смены пояса самим устройством.
 */
const lastTz = new Map<string, string>();

/**
 * Записать пояс из заголовка X-Timezone в User.timezone. Best-effort,
 * НИКОГДА не бросает (зовётся из auth-middleware fire-and-forget, не должен
 * влиять на auth). No-op если: флаг off / нет заголовка / невалидный пояс /
 * тот же пояс что в кэше. При перелёте устройство шлёт новый пояс → обновляем.
 */
export async function captureTimezone(
  userId: string,
  rawTz: unknown,
): Promise<void> {
  try {
    if (!isV2RealtimeEnabled(userId)) return;
    const tz = typeof rawTz === 'string' ? rawTz : undefined;
    if (!tz || !isValidIanaTz(tz)) return;
    if (lastTz.get(userId) === tz) return; // cache: пишем только на смену
    lastTz.set(userId, tz);
    await prisma.user.update({ where: { id: userId }, data: { timezone: tz } });
  } catch (err) {
    console.warn(
      '[tz-capture] best-effort failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
