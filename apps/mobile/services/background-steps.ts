import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useStepStore } from '@/stores/step-store';

const BACKGROUND_STEP_SYNC_TASK = 'BACKGROUND_STEP_SYNC';

// Define the background task — runs even when app is closed
TaskManager.defineTask(BACKGROUND_STEP_SYNC_TASK, async () => {
  try {
    const token = useAuthStore.getState().token;
    if (!token) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const result = await Pedometer.getStepCountAsync(startOfDay, now);
    const steps = result.steps;

    if (steps > 0) {
      const dateStr = now.toISOString().split('T')[0];
      await api.post('/steps', { date: dateStr, steps }, token);

      // Update store if app is in foreground
      useStepStore.getState().setTodaySteps(steps);
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('Background step sync error:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background step sync task.
 * Call this once at app startup (e.g., in _layout.tsx or navigation/index.tsx).
 */
export async function registerBackgroundStepSync(): Promise<void> {
  try {
    // Check if pedometer is available
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      console.warn('Педометр недоступен — фоновая синхронизация шагов отключена');
      return;
    }

    // Request motion permissions on iOS
    if (Platform.OS === 'ios') {
      try {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        await Pedometer.getStepCountAsync(start, now);
      } catch {
        console.warn('Нет разрешения на шаги (Motion & Fitness)');
        return;
      }
    }

    // Check if task is already registered
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_STEP_SYNC_TASK);
    if (isRegistered) {
      return; // Already running
    }

    // Register background fetch — iOS will call this periodically (min ~15 min)
    await BackgroundFetch.registerTaskAsync(BACKGROUND_STEP_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes
      stopOnTerminate: false,   // Keep syncing after app is killed (Android)
      startOnBoot: true,        // Start syncing after device reboot (Android)
    });

    console.debug('Фоновая синхронизация шагов зарегистрирована');
  } catch (error) {
    console.error('Ошибка регистрации фоновой синхронизации шагов:', error);
  }
}

/**
 * Unregister background step sync (e.g., when user logs out).
 */
export async function unregisterBackgroundStepSync(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_STEP_SYNC_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_STEP_SYNC_TASK);
    }
  } catch (error) {
    console.error('Ошибка отмены фоновой синхронизации шагов:', error);
  }
}

/**
 * Get current step count from device sensors (foreground call).
 * Works even if the app was just opened — reads historical data from the sensor.
 */
export async function getCurrentDaySteps(): Promise<number> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) return 0;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const result = await Pedometer.getStepCountAsync(startOfDay, now);
    return result.steps;
  } catch {
    return 0;
  }
}
