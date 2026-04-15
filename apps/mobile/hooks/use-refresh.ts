import { useState, useCallback } from 'react';
import { hapticLight } from '@/services/haptics';

/**
 * Hook for pull-to-refresh pattern.
 * Usage:
 * ```
 * const { refreshing, onRefresh } = useRefresh(async () => {
 *   await fetchTasks();
 *   await fetchHabits();
 * });
 * <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
 * ```
 */
export function useRefresh(refreshFn: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    hapticLight();
    try {
      await refreshFn();
    } catch (err) {
      console.warn('[useRefresh] Error:', err);
    } finally {
      setRefreshing(false);
    }
  }, [refreshFn]);

  return { refreshing, onRefresh };
}
