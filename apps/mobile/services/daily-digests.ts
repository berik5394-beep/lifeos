import { storage } from '@/services/storage';
import { notifyPrefOn } from '@/services/assistant-profile';
import {
  cancelLocalDigests,
  scheduleEveningReview,
  scheduleMorningBriefing,
  scheduleWeeklyReport,
} from '@/services/notifications';

/** Время подъёма по умолчанию — как на сервере (User.wakeUpTime @default("07:00")). */
export const DEFAULT_WAKE_UP = '07:00';
const SERVER_PUSH_KEY = 'server_push_registered';

/**
 * Одна утренняя (вечерняя, недельная) сводка, а не три. Раньше одновременно:
 * локальный «Доброе утро» с цитатой (время из настроек), локальный «брифинг»
 * (по умолчанию 08:00 — отсюда «на экране 07:00, приходит в 08:00») и
 * серверный пуш. Теперь: есть пуш с сервера — локальные снимаем (серверный
 * бриф умнее: бюджет, долги, стиль); пуша нет — одна локальная по времени
 * из настроек.
 */
export async function syncDailyDigests(serverPush: boolean, wakeUpTime?: string): Promise<'server' | 'local'> {
  storage.set(SERVER_PUSH_KEY, serverPush ? '1' : '0');
  if (serverPush) {
    await cancelLocalDigests();
    return 'server';
  }
  await cancelLocalDigests();
  // Тумблеры Настроек (аудит 2026-11-09: раньше их никто не читал).
  if (notifyPrefOn('morningReminder')) {
    await scheduleMorningBriefing(wakeUpTime ?? storage.getString('wakeUpTime') ?? DEFAULT_WAKE_UP);
  }
  if (notifyPrefOn('eveningReview')) await scheduleEveningReview('21:00');
  await scheduleWeeklyReport();
  return 'local';
}

/** Сменили время подъёма — пересобрать по тому же правилу. */
export function resyncDailyDigests(wakeUpTime: string): Promise<'server' | 'local'> {
  return syncDailyDigests(storage.getString(SERVER_PUSH_KEY) === '1', wakeUpTime);
}
