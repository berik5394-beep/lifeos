import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  syncHealthData,
  isHealthSyncEnabled,
  getCachedMetrics,
  requestPermissions,
  HealthMetrics,
} from '@/services/health-connect';
import { useStepStore } from '@/stores/step-store';
import { useJournalStore } from '@/stores/journal-store';
import { useHabitStore } from '@/stores/habit-store';
import { useAuthStore } from '@/stores/auth-store';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 минут
const STEP_HABIT_THRESHOLD = 10_000;

// Названия привычек ходьбы для автозакрытия (проверяем вхождение, не точное совпадение)
const WALK_HABIT_KEYWORDS = [
  '10000 шагов',
  '10 000 шагов',
  'ходьба',
  'прогулка',
  'шаги',
];

interface UseHealthSyncResult {
  metrics: HealthMetrics;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
  lastError: string | null;
}

function getTodayDateStr(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

export function useHealthSync(): UseHealthSyncResult {
  const [metrics, setMetrics] = useState<HealthMetrics>(getCachedMetrics);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const { setTodaySteps } = useStepStore();
  const { saveEntry, todayEntry } = useJournalStore();
  const { habits, logs, toggleHabitLog } = useHabitStore();
  const { token } = useAuthStore();

  const performSync = useCallback(async () => {
    if (!isHealthSyncEnabled() || !token) return;

    setIsSyncing(true);
    setLastError(null);

    try {
      const result = await syncHealthData();
      setMetrics(result);

      // Обновляем step-store
      if (result.steps > 0) {
        setTodaySteps(result.steps);
      }

      // Обновляем дневник если есть данные о сне
      const todayStr = getTodayDateStr();
      if (result.sleepHours !== null && result.sleepHours > 0) {
        const currentSleep = todayEntry?.sleepHours;
        // Записываем только если в дневнике ещё нет данных о сне
        if (currentSleep === null || currentSleep === undefined) {
          await saveEntry({
            date: todayStr,
            sleepHours: result.sleepHours,
          });
        }
      }

      // Автозакрытие привычки ходьбы при >= 10000 шагов
      if (result.steps >= STEP_HABIT_THRESHOLD) {
        await autoCompleteWalkHabit(todayStr);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка синхронизации';
      setLastError(message);
      console.error('useHealthSync: ошибка синхронизации:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [token, setTodaySteps, saveEntry, todayEntry, habits, logs, toggleHabitLog]);

  // Автозакрытие привычки ходьбы
  const autoCompleteWalkHabit = useCallback(
    async (dateStr: string) => {
      const walkHabit = habits.find((h) => {
        if (!h.active) return false;
        const nameLower = h.name.toLowerCase();
        return WALK_HABIT_KEYWORDS.some((kw) => nameLower.includes(kw));
      });

      if (!walkHabit) return;

      // Проверяем, не отмечена ли уже
      const todayLogs = logs[dateStr] ?? [];
      const alreadyDone = todayLogs.some(
        (log) => log.habitId === walkHabit.id && log.completed,
      );

      if (alreadyDone) return;

      try {
        await toggleHabitLog(walkHabit.id, dateStr, true);
        console.debug(
          `Привычка "${walkHabit.name}" автоматически отмечена (${STEP_HABIT_THRESHOLD}+ шагов)`,
        );
      } catch (err) {
        console.error('Ошибка автозакрытия привычки ходьбы:', err);
      }
    },
    [habits, logs, toggleHabitLog],
  );

  // Ручная синхронизация
  const syncNow = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      setLastError('Нет доступа к данным здоровья');
      return;
    }
    await performSync();
  }, [performSync]);

  // Запуск интервальной синхронизации
  useEffect(() => {
    if (!isHealthSyncEnabled() || !token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Синхронизация при монтировании
    performSync();

    // Синхронизация каждые 15 минут
    intervalRef.current = setInterval(performSync, SYNC_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [performSync, token]);

  // Синхронизация при возврате в foreground
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appStateRef.current.match(/inactive|background/) &&
          nextState === 'active' &&
          isHealthSyncEnabled()
        ) {
          performSync();
        }
        appStateRef.current = nextState;
      },
    );

    return () => {
      subscription.remove();
    };
  }, [performSync]);

  return { metrics, isSyncing, syncNow, lastError };
}
