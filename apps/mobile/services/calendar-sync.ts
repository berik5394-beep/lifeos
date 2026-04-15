/**
 * Bidirectional sync between device system calendar (expo-calendar) and LifeOS server.
 *
 * - requestCalendarPermissions() — request read/write access
 * - getDeviceCalendars()         — list available calendars (Google, iCloud, etc.)
 * - syncFromDevice()             — pull events from device → POST to LifeOS
 * - syncToDevice()               — push LifeOS events → device calendar
 * - fullSync()                   — bidirectional sync
 * - getOrCreateLifeOSCalendar()  — find or create a "LifeOS" calendar on device
 *
 * Settings persisted via storage:
 *   - calendar_sync_enabled       (boolean)
 *   - calendar_sync_selected_id   (string)
 *   - calendar_sync_last_time     (ISO string)
 *   - calendar_sync_event_count   (string number)
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';

/* ───────── Storage keys ───────── */
const KEYS = {
  enabled: 'calendar_sync_enabled',
  selectedId: 'calendar_sync_selected_id',
  lastSync: 'calendar_sync_last_time',
  eventCount: 'calendar_sync_event_count',
} as const;

/* ───────── Types ───────── */
export interface DeviceCalendar {
  id: string;
  title: string;
  source: string;
  color: string;
  allowsModifications: boolean;
}

interface ServerCalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  reminder: number;
  source: string;
}

interface CreateEventPayload {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  source?: string;
}

interface SyncResult {
  imported: number;
  exported: number;
}

/* ───────── Permissions ───────── */

export async function requestCalendarPermissions(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

/** @deprecated Use requestCalendarPermissions */
export const requestCalendarPermission = requestCalendarPermissions;

/* ───────── Calendar listing ───────── */

export async function getDeviceCalendars(): Promise<DeviceCalendar[]> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars.map((cal) => ({
      id: cal.id,
      title: cal.title,
      source: cal.source?.name ?? 'unknown',
      color: cal.color ?? '#6366F1',
      allowsModifications: cal.allowsModifications ?? false,
    }));
  } catch (err) {
    console.error('Ошибка получения календарей:', err);
    return [];
  }
}

/* ───────── LifeOS calendar on device ───────── */

export async function getOrCreateLifeOSCalendar(): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

    // Try to find existing LifeOS calendar
    const existing = calendars.find((c) => c.title === 'LifeOS');
    if (existing) return existing.id;

    // Create a new calendar
    if (Platform.OS === 'ios') {
      const sources = await Calendar.getSourcesAsync();
      const defaultSource =
        sources.find((s) => s.type === Calendar.SourceType.CALDAV) ??
        sources.find((s) => s.type === Calendar.SourceType.LOCAL) ??
        sources[0];
      if (!defaultSource) return null;

      const calId = await Calendar.createCalendarAsync({
        title: 'LifeOS',
        color: '#6366F1',
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: defaultSource.id,
        source: {
          isLocalAccount: true,
          name: defaultSource.name,
          type: defaultSource.type,
        },
        name: 'LifeOS',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
        ownerAccount: 'LifeOS',
      });
      return calId;
    }

    // Android
    const calId = await Calendar.createCalendarAsync({
      title: 'LifeOS',
      color: '#6366F1',
      entityType: Calendar.EntityTypes.EVENT,
      source: {
        isLocalAccount: true,
        name: 'LifeOS',
        type: Calendar.SourceType.LOCAL,
      },
      name: 'LifeOS',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
      ownerAccount: 'lifeos@local',
    });
    return calId;
  } catch (err) {
    console.error('Ошибка создания LifeOS календаря:', err);
    return null;
  }
}

/* ───────── Helpers ───────── */

function getToken(): string | null {
  return useAuthStore.getState().token;
}

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function parseDate(dateStr: string, timeStr: string | null | undefined): Date {
  const d = new Date(dateStr + 'T00:00:00');
  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

function dateRange30(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/* ───────── Sync FROM device → LifeOS server ───────── */

export async function syncFromDevice(calendarId?: string): Promise<number> {
  const token = getToken();
  if (!token) return 0;

  const granted = await requestCalendarPermissions();
  if (!granted) return 0;

  try {
    const ids: string[] = [];
    if (calendarId) {
      ids.push(calendarId);
    } else {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      ids.push(...calendars.map((c) => c.id));
    }

    if (ids.length === 0) return 0;

    const { start, end } = dateRange30();
    const deviceEvents = await Calendar.getEventsAsync(ids, start, end);

    let imported = 0;
    for (const ev of deviceEvents) {
      const payload: CreateEventPayload = {
        title: ev.title,
        date: new Date(ev.startDate).toISOString().split('T')[0],
        startTime: ev.allDay ? undefined : formatTime(new Date(ev.startDate)),
        endTime: ev.allDay ? undefined : formatTime(new Date(ev.endDate)),
        location: ev.location ?? undefined,
        description: ev.notes ?? undefined,
        source: 'imported',
      };

      try {
        await api.post('/events', payload, token);
        imported++;
      } catch {
        // Duplicate or validation error — skip
      }
    }

    return imported;
  } catch (err) {
    console.error('syncFromDevice error:', err);
    return 0;
  }
}

/** @deprecated Use syncFromDevice */
export const importEventsFromCalendar = (
  calendarId: string,
  _startDate: Date,
  _endDate: Date,
): Promise<number> => syncFromDevice(calendarId);

/* ───────── Sync TO device ← LifeOS server ───────── */

export async function syncToDevice(calendarId?: string): Promise<number> {
  const token = getToken();
  if (!token) return 0;

  const granted = await requestCalendarPermissions();
  if (!granted) return 0;

  try {
    const targetCalId = calendarId ?? (await getOrCreateLifeOSCalendar());
    if (!targetCalId) return 0;

    // Verify the calendar is writable
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const target = calendars.find((c) => c.id === targetCalId);
    if (!target || !target.allowsModifications) return 0;

    // Fetch LifeOS events for next 30 days
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const serverEvents = await api.get<ServerCalendarEvent[]>(
      `/events?month=${monthStr}`,
      token,
    );

    // Read existing device events to avoid duplicates
    const { start, end } = dateRange30();
    const existingDeviceEvents = await Calendar.getEventsAsync([targetCalId], start, end);
    const existingTitles = new Set(
      existingDeviceEvents.map((e) => `${e.title}|${new Date(e.startDate).toISOString().split('T')[0]}`),
    );

    let exported = 0;
    for (const ev of serverEvents) {
      const key = `${ev.title}|${ev.date}`;
      if (existingTitles.has(key)) continue;

      const startDate = parseDate(ev.date, ev.startTime);
      const endDate = ev.endTime
        ? parseDate(ev.date, ev.endTime)
        : new Date(startDate.getTime() + 60 * 60 * 1000); // default 1h

      try {
        await Calendar.createEventAsync(targetCalId, {
          title: ev.title,
          startDate,
          endDate,
          location: ev.location ?? undefined,
          notes: ev.description ?? undefined,
          timeZone: 'Asia/Almaty',
        });
        exported++;
      } catch {
        // Skip on error
      }
    }

    return exported;
  } catch (err) {
    console.error('syncToDevice error:', err);
    return 0;
  }
}

/* ───────── Full bidirectional sync ───────── */

export async function fullSync(calendarId?: string): Promise<SyncResult> {
  const imported = await syncFromDevice(calendarId);
  const exported = await syncToDevice(calendarId);

  // Persist last sync time and count
  storage.set(KEYS.lastSync, new Date().toISOString());
  storage.set(KEYS.eventCount, String(imported + exported));

  return { imported, exported };
}

/* ───────── Legacy compat ───────── */

export async function syncCalendarEvents(): Promise<number> {
  const result = await fullSync();
  return result.imported + result.exported;
}

export async function createSystemCalendarEvent(params: {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
}): Promise<string | null> {
  const granted = await requestCalendarPermissions();
  if (!granted) return null;

  try {
    const calId = await getOrCreateLifeOSCalendar();
    if (!calId) return null;

    const eventId = await Calendar.createEventAsync(calId, {
      title: params.title,
      startDate: params.startDate,
      endDate: params.endDate,
      location: params.location,
      notes: params.notes,
      timeZone: 'Asia/Almaty',
    });

    return eventId;
  } catch (err) {
    console.error('Ошибка создания события в календаре:', err);
    return null;
  }
}

/* ───────── Settings persistence ───────── */

export function isCalendarSyncEnabled(): boolean {
  return storage.getBoolean(KEYS.enabled) ?? false;
}

export function setCalendarSyncEnabled(enabled: boolean): void {
  storage.setBoolean(KEYS.enabled, enabled);
}

export function getSelectedCalendarId(): string | undefined {
  return storage.getString(KEYS.selectedId);
}

export function setSelectedCalendarId(id: string): void {
  storage.set(KEYS.selectedId, id);
}

export function getLastCalendarSyncTime(): string | undefined {
  return storage.getString(KEYS.lastSync);
}

export function getSyncedEventCount(): number {
  const val = storage.getString(KEYS.eventCount);
  return val ? parseInt(val, 10) : 0;
}
