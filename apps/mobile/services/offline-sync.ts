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
import { initOfflineManager, networkMonitor, offlineQueue } from '@/services/offline-manager';

/** Перечитать то, что могли изменить отправленные записи. Ленивый require — без циклов импорта. */
function refreshStores(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { useTaskStore } = require('@/stores/task-store') as typeof import('@/stores/task-store');
  const { useHabitStore } = require('@/stores/habit-store') as typeof import('@/stores/habit-store');
  const { useFinanceStore } = require('@/stores/finance-store') as typeof import('@/stores/finance-store');
  const { useJournalStore } = require('@/stores/journal-store') as typeof import('@/stores/journal-store');
  /* eslint-enable @typescript-eslint/no-require-imports */
  useTaskStore.getState().fetchTasks().catch(() => {});
  useHabitStore.getState().fetchHabits().catch(() => {});
  useFinanceStore.getState().fetchExpenses().catch(() => {});
  useFinanceStore.getState().fetchIncomes().catch(() => {});
  useJournalStore.getState().refreshAfterSync();
}

export async function flushOfflineQueue(): Promise<{ success: number; failed: number }> {
  if (offlineQueue.pendingCount === 0) return { success: 0, failed: 0 };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuthStore } = require('@/stores/auth-store') as typeof import('@/stores/auth-store');
  const token = useAuthStore.getState().token;
  if (!token) return { success: 0, failed: 0 };
  const res = await offlineQueue.sync((m) => api.replayQueued(m, useAuthStore.getState().token ?? token));
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
