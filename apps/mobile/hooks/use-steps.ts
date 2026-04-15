import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { useStepStore } from '@/stores/step-store';
import { getCurrentDaySteps } from '@/services/background-steps';

interface UseStepsResult {
  steps: number;
  isAvailable: boolean;
  refresh: () => Promise<void>;
}

export function useSteps(): UseStepsResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const subscriptionRef = useRef<ReturnType<typeof Pedometer.watchStepCount> | null>(null);
  const { todaySteps, setTodaySteps } = useStepStore();
  const baseStepsRef = useRef(0);

  // Refresh steps from device sensor (reads ALL steps since midnight, even from background)
  const refreshSteps = useCallback(async () => {
    try {
      const steps = await getCurrentDaySteps();
      if (steps > 0) {
        baseStepsRef.current = steps;
        setTodaySteps(steps);
      }
    } catch {
      // Ignore
    }
  }, [setTodaySteps]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (!mounted) return;
        setIsAvailable(available);

        if (!available) return;

        // Get ALL steps from start of day (includes steps taken while app was closed!)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        try {
          const result = await Pedometer.getStepCountAsync(startOfDay, now);
          if (!mounted) return;
          baseStepsRef.current = result.steps;
          setTodaySteps(result.steps);
        } catch {
          // Pedometer history not available on all devices
        }

        // Watch for NEW steps in real-time while app is open
        subscriptionRef.current = Pedometer.watchStepCount((result) => {
          if (!mounted) return;
          // result.steps = incremental steps since watchStepCount started
          const totalSteps = baseStepsRef.current + result.steps;
          setTodaySteps(totalSteps);
        });
      } catch {
        if (mounted) {
          setIsAvailable(false);
        }
      }
    }

    init();

    // Re-fetch steps when app comes back to foreground
    // This ensures steps taken during background/closed state are counted
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && mounted) {
        // Re-read full day's steps from sensor
        Pedometer.isAvailableAsync().then((available) => {
          if (!available || !mounted) return;
          const now = new Date();
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          Pedometer.getStepCountAsync(startOfDay, now).then((result) => {
            if (!mounted) return;
            baseStepsRef.current = result.steps;
            setTodaySteps(result.steps);

            // Restart watcher so incremental count resets
            if (subscriptionRef.current) {
              subscriptionRef.current.remove();
            }
            subscriptionRef.current = Pedometer.watchStepCount((watchResult) => {
              if (!mounted) return;
              const totalSteps = baseStepsRef.current + watchResult.steps;
              setTodaySteps(totalSteps);
            });
          }).catch(() => { /* ignore */ });
        }).catch(() => { /* ignore */ });
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      mounted = false;
      appStateSubscription.remove();
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [setTodaySteps]);

  return { steps: todaySteps, isAvailable, refresh: refreshSteps };
}
