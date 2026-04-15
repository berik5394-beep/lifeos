import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';

// ─────────────────────────────────────────────────────────────────────────────
// HealthService — абстракция над данными здоровья (шаги, сон, пульс, калории)
//
// Сейчас:
//   - Шаги: expo-sensors Pedometer (iOS CoreMotion / Android step sensor)
//   - Сон, пульс, калории: заглушки с TODO
//
// TODO (после eject / dev-client):
//   - iOS:  react-native-health (HealthKit) — сон, пульс, калории, детальные шаги
//   - Android: react-native-health-connect (Health Connect API) — то же самое
//   - Оба пакета требуют нативных модулей, не доступных в Expo Go
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY_ENABLED = 'health_sync_enabled';
const STORAGE_KEY_LAST_SYNC = 'health_sync_last_sync';
const STORAGE_KEY_LAST_STEPS = 'health_sync_last_steps';
const STORAGE_KEY_LAST_SLEEP = 'health_sync_last_sleep';
const STORAGE_KEY_LAST_CALORIES = 'health_sync_last_calories';
const STORAGE_KEY_LAST_HR = 'health_sync_last_hr';

export interface HealthMetrics {
  steps: number;
  sleepHours: number | null;
  heartRate: number | null;
  activeCalories: number | null;
  lastSyncAt: string | null;
}

export interface DaySteps {
  date: string;
  steps: number;
}

// ────────── Настройки ──────────

export function isHealthSyncEnabled(): boolean {
  return storage.getBoolean(STORAGE_KEY_ENABLED) ?? false;
}

export function setHealthSyncEnabled(enabled: boolean): void {
  storage.setBoolean(STORAGE_KEY_ENABLED, enabled);
}

export function getLastSyncTime(): string | null {
  return storage.getString(STORAGE_KEY_LAST_SYNC) ?? null;
}

function saveLastSyncTime(): void {
  storage.set(STORAGE_KEY_LAST_SYNC, new Date().toISOString());
}

// ────────── Кэш последних метрик ──────────

export function getCachedMetrics(): HealthMetrics {
  const stepsStr = storage.getString(STORAGE_KEY_LAST_STEPS);
  const sleepStr = storage.getString(STORAGE_KEY_LAST_SLEEP);
  const caloriesStr = storage.getString(STORAGE_KEY_LAST_CALORIES);
  const hrStr = storage.getString(STORAGE_KEY_LAST_HR);

  return {
    steps: stepsStr ? parseInt(stepsStr, 10) : 0,
    sleepHours: sleepStr ? parseFloat(sleepStr) : null,
    heartRate: hrStr ? parseInt(hrStr, 10) : null,
    activeCalories: caloriesStr ? parseInt(caloriesStr, 10) : null,
    lastSyncAt: getLastSyncTime(),
  };
}

function cacheMetrics(metrics: Partial<HealthMetrics>): void {
  if (metrics.steps !== undefined) {
    storage.set(STORAGE_KEY_LAST_STEPS, String(metrics.steps));
  }
  if (metrics.sleepHours !== undefined && metrics.sleepHours !== null) {
    storage.set(STORAGE_KEY_LAST_SLEEP, String(metrics.sleepHours));
  }
  if (metrics.activeCalories !== undefined && metrics.activeCalories !== null) {
    storage.set(STORAGE_KEY_LAST_CALORIES, String(metrics.activeCalories));
  }
  if (metrics.heartRate !== undefined && metrics.heartRate !== null) {
    storage.set(STORAGE_KEY_LAST_HR, String(metrics.heartRate));
  }
}

// ────────── Разрешения ──────────

export async function requestPermissions(): Promise<boolean> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      console.warn('Педометр недоступен на этом устройстве');
      return false;
    }

    // На iOS запрос шагов неявно запрашивает разрешение HealthKit.
    // На Android используется встроенный датчик шагов.
    if (Platform.OS === 'ios') {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      try {
        await Pedometer.getStepCountAsync(start, now);
        return true;
      } catch {
        console.warn('Нет разрешения на доступ к шагам (HealthKit)');
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Ошибка проверки доступности педометра:', err);
    return false;
  }
}

// ────────── Шаги ──────────

export async function getStepsToday(): Promise<number> {
  try {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const result = await Pedometer.getStepCountAsync(start, now);
    return result.steps;
  } catch (err) {
    console.error('Ошибка получения шагов за сегодня:', err);
    return 0;
  }
}

export async function getStepsForDate(date: Date): Promise<number> {
  try {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const result = await Pedometer.getStepCountAsync(start, end);
    return result.steps;
  } catch (err) {
    console.error('Ошибка получения шагов за дату:', date, err);
    return 0;
  }
}

// ────────── Сон ──────────
// TODO: Реализовать через react-native-health (iOS) / react-native-health-connect (Android)
// после перехода на dev-client. Сейчас возвращает null.

export async function getSleepHours(_date: Date): Promise<number | null> {
  // TODO: iOS — HKCategoryTypeIdentifierSleepAnalysis через HealthKit
  // TODO: Android — SleepSessionRecord через Health Connect
  //
  // Пример (после добавления react-native-health):
  // if (Platform.OS === 'ios') {
  //   const options = {
  //     startDate: startOfDay.toISOString(),
  //     endDate: endOfDay.toISOString(),
  //   };
  //   const sleepData = await AppleHealthKit.getSleepSamples(options);
  //   return calculateTotalSleepHours(sleepData);
  // }
  return null;
}

// ────────── Пульс ──────────
// TODO: Реализовать через native health SDK после eject

export async function getHeartRate(): Promise<number | null> {
  // TODO: iOS — HKQuantityTypeIdentifierRestingHeartRate
  // TODO: Android — RestingHeartRateRecord
  //
  // Пример:
  // if (Platform.OS === 'ios') {
  //   const options = { unit: 'bpm', ascending: false, limit: 1 };
  //   const data = await AppleHealthKit.getRestingHeartRateSamples(options);
  //   return data[0]?.value ?? null;
  // }
  return null;
}

// ────────── Активные калории ──────────
// TODO: Реализовать через native health SDK после eject

export async function getActiveCalories(_date: Date): Promise<number | null> {
  // TODO: iOS — HKQuantityTypeIdentifierActiveEnergyBurned
  // TODO: Android — ActiveCaloriesBurnedRecord
  //
  // Пример:
  // if (Platform.OS === 'ios') {
  //   const options = {
  //     startDate: startOfDay.toISOString(),
  //     endDate: endOfDay.toISOString(),
  //   };
  //   const data = await AppleHealthKit.getActiveEnergyBurned(options);
  //   return data.reduce((sum, d) => sum + d.value, 0);
  // }
  return null;
}

// ────────── Полная синхронизация ──────────

export async function syncHealthData(): Promise<HealthMetrics> {
  const token = useAuthStore.getState().token;
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  // Шаги — всегда доступны через Pedometer
  const steps = await getStepsToday();

  // Сохраняем шаги на сервер если авторизованы
  if (token && steps > 0) {
    try {
      await api.post('/steps', { date: dateStr, steps }, token);
    } catch (err) {
      console.error('Ошибка сохранения шагов на сервер:', err);
    }
  }

  // Сон, пульс, калории — пока заглушки (TODO: native SDK)
  const sleepHours = await getSleepHours(today);
  const heartRate = await getHeartRate();
  const activeCalories = await getActiveCalories(today);

  const metrics: HealthMetrics = {
    steps,
    sleepHours,
    heartRate,
    activeCalories,
    lastSyncAt: new Date().toISOString(),
  };

  // Кэшируем и сохраняем время последней синхронизации
  cacheMetrics(metrics);
  saveLastSyncTime();

  return metrics;
}

// ────────── Синхронизация шагов за неделю ──────────

export async function syncWeekSteps(): Promise<DaySteps[]> {
  const token = useAuthStore.getState().token;
  if (!token) return [];

  const results: DaySteps[] = [];
  const today = new Date();

  // Начало текущей недели (понедельник)
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);

    // Не синхронизируем будущие дни
    if (day > today) break;

    try {
      const steps = await getStepsForDate(day);
      const dateStr = day.toISOString().split('T')[0];

      await api.post('/steps', { date: dateStr, steps }, token);
      results.push({ date: dateStr, steps });
    } catch (err) {
      console.error('Ошибка синхронизации шагов за день:', day, err);
    }
  }

  return results;
}

// ────────── Имя провайдера для UI ──────────

export function getHealthProviderName(): string {
  return Platform.OS === 'ios' ? 'Apple Health' : 'Google Fit';
}
