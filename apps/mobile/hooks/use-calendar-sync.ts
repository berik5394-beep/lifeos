/**
 * Hook for automatic device calendar sync.
 *
 * - Auto-syncs on mount (if enabled)
 * - Re-syncs every 30 minutes
 * - Re-syncs on app foreground
 * - Exposes: isSyncing, lastSync, syncNow, calendars, selectedCalendar, setSelectedCalendar
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  fullSync,
  getDeviceCalendars,
  isCalendarSyncEnabled,
  setCalendarSyncEnabled as persistEnabled,
  getSelectedCalendarId,
  setSelectedCalendarId as persistSelectedId,
  getLastCalendarSyncTime,
  getSyncedEventCount,
  requestCalendarPermissions,
  DeviceCalendar,
} from '@/services/calendar-sync';
import { useAuthStore } from '@/stores/auth-store';
import { useEventStore } from '@/stores/event-store';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 минут

export interface UseCalendarSyncResult {
  isSyncing: boolean;
  lastSync: string | null;
  syncNow: () => Promise<void>;
  calendars: DeviceCalendar[];
  selectedCalendar: string | null;
  setSelectedCalendar: (id: string) => void;
  syncEnabled: boolean;
  setSyncEnabled: (enabled: boolean) => Promise<void>;
  syncedEventCount: number;
  loadCalendars: () => Promise<void>;
}

export function useCalendarSync(): UseCalendarSyncResult {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(
    getLastCalendarSyncTime() ?? null,
  );
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [selectedCalendar, setSelectedCalendarState] = useState<string | null>(
    getSelectedCalendarId() ?? null,
  );
  const [syncEnabled, setSyncEnabledState] = useState(isCalendarSyncEnabled);
  const [syncedEventCount, setSyncedEventCount] = useState(getSyncedEventCount);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const token = useAuthStore((s) => s.token);
  const fetchEvents = useEventStore((s) => s.fetchEvents);

  /* ── Load calendars ── */
  const loadCalendars = useCallback(async () => {
    const granted = await requestCalendarPermissions();
    if (!granted) return;
    const cals = await getDeviceCalendars();
    setCalendars(cals);
  }, []);

  /* ── Sync action ── */
  const syncNow = useCallback(async () => {
    if (!token) return;
    setIsSyncing(true);
    try {
      const result = await fullSync(selectedCalendar ?? undefined);
      const now = new Date().toISOString();
      setLastSync(now);
      setSyncedEventCount(result.imported + result.exported);
      // Refresh event store so UI updates
      await fetchEvents();
    } catch (err) {
      console.error('Calendar sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [token, selectedCalendar, fetchEvents]);

  /* ── Select calendar ── */
  const setSelectedCalendar = useCallback((id: string) => {
    setSelectedCalendarState(id);
    persistSelectedId(id);
  }, []);

  /* ── Enable / disable ── */
  const setSyncEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const granted = await requestCalendarPermissions();
        if (!granted) return;
      }
      setSyncEnabledState(enabled);
      persistEnabled(enabled);

      if (enabled && token) {
        await loadCalendars();
        // Trigger immediate sync
        setIsSyncing(true);
        try {
          const result = await fullSync(selectedCalendar ?? undefined);
          setLastSync(new Date().toISOString());
          setSyncedEventCount(result.imported + result.exported);
          await fetchEvents();
        } catch {
          // Non-critical
        } finally {
          setIsSyncing(false);
        }
      }
    },
    [token, selectedCalendar, fetchEvents, loadCalendars],
  );

  /* ── Auto-sync on mount ── */
  useEffect(() => {
    if (!syncEnabled || !token) return;

    loadCalendars();

    // Initial sync
    const initialTimeout = setTimeout(() => {
      syncNow();
    }, 2000); // Small delay to let app settle

    // Interval sync every 30 minutes
    intervalRef.current = setInterval(() => {
      syncNow();
    }, SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [syncEnabled, token, syncNow, loadCalendars]);

  /* ── Re-sync on app foreground ── */
  useEffect(() => {
    if (!syncEnabled || !token) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        syncNow();
      }
      appStateRef.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [syncEnabled, token, syncNow]);

  return {
    isSyncing,
    lastSync,
    syncNow,
    calendars,
    selectedCalendar,
    setSelectedCalendar,
    syncEnabled,
    setSyncEnabled,
    syncedEventCount,
    loadCalendars,
  };
}
