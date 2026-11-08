import { Platform } from 'react-native';
import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/utils/dates';

/**
 * «Здоровье» iPhone → LifeOS (сборка №15+): шаги за сегодня/вчера → /steps,
 * сон прошлой ночи → дневник (/journal sleepHours; настроение и заметки не
 * трогаются). Только чтение, только после разрешения человека. Включается в
 * Настройках; дальше — при каждом открытии, не чаще раза в 20 минут.
 */
const ENABLED_KEY = 'health_enabled';
const LAST_SYNC_KEY = 'health_last_sync';
const MIN_INTERVAL_MS = 20 * 60_000;
const DAY = 86_400_000;

/** Значения сна «спал» (HKCategoryValueSleepAnalysis): unspecified, core, deep, REM. */
const ASLEEP = new Set([1, 3, 4, 5]);

export interface SleepSample {
  value: number;
  startDate: Date;
  endDate: Date;
}

/**
 * Часы сна из отрезков: только «спал», пересечения склеиваются (часы и телефон
 * пишут одну ночь дважды). Округление до 0,1 ч. Чистая.
 */
export function sleepHoursFromSamples(samples: SleepSample[]): number {
  const iv = samples
    .filter((s) => ASLEEP.has(s.value) && s.endDate > s.startDate)
    .map((s) => [s.startDate.getTime(), s.endDate.getTime()] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else if (b > cur[1]) cur[1] = b;
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 3_600_000) * 10) / 10;
}

export function isHealthEnabled(): boolean {
  return Platform.OS === 'ios' && storage.getBoolean(ENABLED_KEY) === true;
}

type HK = typeof import('@kingstinct/react-native-healthkit');
function healthkit(): HK | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // Лениво: модуль нативный (сборка №15+), на старых сборках его нет.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hk = require('@kingstinct/react-native-healthkit') as HK;
    return hk.isHealthDataAvailable() ? hk : null;
  } catch {
    return null;
  }
}

export function isHealthAvailable(): boolean {
  return healthkit() !== null;
}

/** Включить: спросить разрешение на чтение сна и шагов. false — нет «Здоровья»/отказ. */
export async function enableHealth(): Promise<boolean> {
  const hk = healthkit();
  if (!hk) return false;
  try {
    await hk.requestAuthorization({
      toRead: ['HKCategoryTypeIdentifierSleepAnalysis', 'HKQuantityTypeIdentifierStepCount'],
    });
  } catch {
    return false;
  }
  storage.setBoolean(ENABLED_KEY, true);
  storage.remove(LAST_SYNC_KEY);
  await syncHealth(true);
  return true;
}

export function disableHealth(): void {
  storage.setBoolean(ENABLED_KEY, false);
}

async function stepsBetween(hk: HK, start: Date, end: Date): Promise<number> {
  const r = await hk.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], {
    filter: { date: { startDate: start, endDate: end } },
    unit: 'count',
  });
  return Math.round(r.sumQuantity?.quantity ?? 0);
}

/** Синхронизация (тихо: ошибки не показываем — «Здоровье» не главное в ходе). */
export async function syncHealth(force = false, now: Date = new Date()): Promise<void> {
  if (!isHealthEnabled()) return;
  const token = useAuthStore.getState().token;
  const hk = healthkit();
  if (!token || !hk) return;
  const last = Number(storage.getString(LAST_SYNC_KEY) ?? 0);
  if (!force && now.getTime() - last < MIN_INTERVAL_MS) return;
  storage.set(LAST_SYNC_KEY, String(now.getTime()));
  try {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yStart = new Date(todayStart.getTime() - DAY);
    const [today, yesterday] = await Promise.all([stepsBetween(hk, todayStart, now), stepsBetween(hk, yStart, todayStart)]);
    if (yesterday > 0) await api.post('/steps', { date: formatDate(yStart), steps: yesterday }, token);
    if (today > 0) await api.post('/steps', { date: formatDate(todayStart), steps: today }, token);

    // Сон прошлой ночи: с 18:00 вчера до 14:00 сегодня.
    const from = new Date(todayStart.getTime() - 6 * 3_600_000);
    const to = new Date(Math.min(now.getTime(), todayStart.getTime() + 14 * 3_600_000));
    const samples = await hk.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
      limit: 0,
      filter: { date: { startDate: from, endDate: to } },
    });
    const hours = sleepHoursFromSamples(
      samples.map((s) => ({ value: Number(s.value), startDate: new Date(s.startDate), endDate: new Date(s.endDate) })),
    );
    if (hours > 0) await api.post('/journal', { date: formatDate(todayStart), sleepHours: hours }, token);
  } catch (err) {
    console.warn('[health] sync failed:', err instanceof Error ? err.message : err);
  }
}
