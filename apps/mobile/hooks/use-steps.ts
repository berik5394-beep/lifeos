import { useState, useEffect, useRef } from 'react';
import { Pedometer } from 'expo-sensors';
import { useStepStore } from '@/stores/step-store';

interface UseStepsResult {
  steps: number;
  isAvailable: boolean;
}

export function useSteps(): UseStepsResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const subscriptionRef = useRef<ReturnType<typeof Pedometer.watchStepCount> | null>(null);
  const { todaySteps, setTodaySteps } = useStepStore();
  const baseStepsRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (!mounted) return;
        setIsAvailable(available);

        if (!available) return;

        // Get steps from start of day
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

        // Watch for new steps
        subscriptionRef.current = Pedometer.watchStepCount((result) => {
          if (!mounted) return;
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

    return () => {
      mounted = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [setTodaySteps]);

  return { steps: todaySteps, isAvailable };
}
