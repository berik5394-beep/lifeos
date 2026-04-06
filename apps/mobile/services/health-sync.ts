import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

// TODO: Full Apple Health integration (sleep, heart rate, calories)
// requires expo-apple-health-kit or a native module not in expo SDK.
// For now, steps are synced via expo-sensors Pedometer.

interface DaySteps {
  date: string;
  steps: number;
}

export async function getHealthPermissions(): Promise<boolean> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      console.warn('Педометр недоступен на этом устройстве');
      return false;
    }

    // On iOS, requesting step count implicitly requests HealthKit permission.
    // On Android, it uses the built-in step counter sensor.
    if (Platform.OS === 'ios') {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      try {
        await Pedometer.getStepCountAsync(start, now);
        return true;
      } catch {
        console.warn('Нет разрешения на доступ к шагам');
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Ошибка проверки доступности педометра:', err);
    return false;
  }
}

export async function syncStepsFromHealth(date: Date): Promise<number> {
  const token = useAuthStore.getState().token;
  if (!token) return 0;

  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await Pedometer.getStepCountAsync(startOfDay, endOfDay);
    const steps = result.steps;

    const dateStr = date.toISOString().split('T')[0];
    await api.post('/steps', { date: dateStr, steps }, token);

    return steps;
  } catch (err) {
    console.error('Ошибка синхронизации шагов:', err);
    return 0;
  }
}

export async function syncWeekSteps(): Promise<DaySteps[]> {
  const token = useAuthStore.getState().token;
  if (!token) return [];

  const results: DaySteps[] = [];
  const today = new Date();

  // Get the start of the current week (Monday)
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);

    // Don't sync future days
    if (day > today) break;

    try {
      const startOfDay = new Date(day);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(day);
      endOfDay.setHours(23, 59, 59, 999);

      const result = await Pedometer.getStepCountAsync(startOfDay, endOfDay);
      const dateStr = day.toISOString().split('T')[0];

      await api.post('/steps', { date: dateStr, steps: result.steps }, token);

      results.push({ date: dateStr, steps: result.steps });
    } catch (err) {
      console.error('Ошибка синхронизации шагов за день:', day, err);
    }
  }

  return results;
}
