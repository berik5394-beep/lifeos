/**
 * Отправка офлайн-очереди. Раньше initOfflineManager нигде не вызывался:
 * сеть не отслеживалась, а записи без сети копились в очереди навсегда.
 *
 * startOfflineSync() — один раз при старте: следит за сетью, отправляет
 * очередь при появлении связи и при возврате в приложение, затем
 * перечитывает сторы, чтобы локальные «офлайн-…» записи сменились настоящими.
 */
import { AppState } from 'react-native';
import { api } from '@/services/api';
import { clearCache, initOfflineManager, networkMonitor, offlineQueue } from '@/services/offline-manager';
import { storage } from '@/services/storage';

/** Перечитать то, что могли изменить отправленные записи. Ленивый require — без циклов импорта. */
function refreshStores(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { useHabitStore } = require('@/stores/habit-store') as typeof import('@/stores/habit-store');
  const { useJournalStore } = require('@/stores/journal-store') as typeof import('@/stores/journal-store');
  const { useScheduleStore } = require('@/stores/schedule-store') as typeof import('@/stores/schedule-store');
  /* eslint-enable @typescript-eslint/no-require-imports */
  // Аудит 2026-11-09: раньше fetchExpenses()/fetchIncomes() без месяца заменяли список
  // последними 50 за всё время (октябрь против ноябрьских лимитов), а отметки привычек
  // не перечитывались. Сигнал revision — каждый экран перечитает СВОЙ диапазон
  // (задачи недели/месяца, траты месяца, отметки привычек).
  useHabitStore.getState().fetchHabits().catch(() => {});
  useScheduleStore.getState().bump();
  useJournalStore.getState().refreshAfterSync();
}

export async function flushOfflineQueue(): Promise<{ success: number; failed: number }> {
  if (offlineQueue.pendingCount === 0) return { success: 0, failed: 0 };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuthStore } = require('@/stores/auth-store') as typeof import('@/stores/auth-store');
  const { token, user } = useAuthStore.getState();
  if (!token || !user?.id) return { success: 0, failed: 0 };
  // Только записи этого же пользователя (очередь хранится на телефоне, а входят
  // на нём могут разные аккаунты).
  const res = await offlineQueue.sync(
    (m) => api.replayQueued(m, useAuthStore.getState().token ?? token),
    user.id,
  );
  if (res.success + res.failed > 0) refreshStores();
  return res;
}

let started = false;

export async function startOfflineSync(): Promise<void> {
  if (started) return;
  started = true;
  await initOfflineManager();
  networkMonitor.onChange((connected) => {
    if (connected) flushOfflineQueue().catch(() => {});
  });
  AppState.addEventListener('change', (s) => {
    if (s === 'active') flushOfflineQueue().catch(() => {});
  });
  flushOfflineQueue().catch(() => {});
}

/** Ключи на телефоне, привязанные к пользователю, но лежащие без его id. */
const USER_LOCAL_PREFIXES = ['week_notes:', 'water:'];
const USER_LOCAL_KEYS = ['lastGreetingDate', 'server_push_registered'];

/**
 * Выход / удаление аккаунта: на телефоне не остаётся данных прежнего
 * пользователя — очередь записей (иначе ушла бы в следующий аккаунт),
 * кэш ответов (без сети следующий увидел бы чужие задачи и финансы),
 * заметки недели и вода.
 */
export async function wipeUserDeviceData(): Promise<void> {
  await offlineQueue.clear();
  await clearCache().catch(() => {});
  for (const k of storage.keys()) {
    if (USER_LOCAL_KEYS.includes(k) || USER_LOCAL_PREFIXES.some((p) => k.startsWith(p))) storage.remove(k);
  }
}
