import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useStepStore } from '@/stores/step-store';

interface UseLocationTrackingResult {
  hasPermission: boolean;
}

export function useLocationTracking(): UseLocationTrackingResult {
  const [hasPermission, setHasPermission] = useState(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const { isTracking, addGpsPoint } = useStepStore();

  // Request permissions on mount
  useEffect(() => {
    let mounted = true;

    async function requestPermissions() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (mounted) {
          setHasPermission(status === 'granted');
        }
      } catch {
        if (mounted) {
          setHasPermission(false);
        }
      }
    }

    requestPermissions();

    return () => {
      mounted = false;
    };
  }, []);

  // Start/stop watching based on isTracking
  useEffect(() => {
    if (!isTracking || !hasPermission) {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      return;
    }

    let subscription: Location.LocationSubscription | null = null;

    async function startWatching() {
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 10,
          },
          (location) => {
            addGpsPoint({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              timestamp: location.timestamp,
            });
          },
        );
        subscriptionRef.current = subscription;
      } catch {
        // Location watching failed
      }
    }

    startWatching();

    return () => {
      if (subscription) {
        subscription.remove();
      }
      subscriptionRef.current = null;
    };
  }, [isTracking, hasPermission, addGpsPoint]);

  return { hasPermission };
}
