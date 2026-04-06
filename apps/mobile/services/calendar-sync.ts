import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface DeviceCalendar {
  id: string;
  title: string;
  source: string;
}

interface CalendarEvent {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  source: string;
}

export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.error('Ошибка запроса разрешений календаря:', err);
    return false;
  }
}

export async function getDeviceCalendars(): Promise<DeviceCalendar[]> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars.map((cal) => ({
      id: cal.id,
      title: cal.title,
      source: cal.source?.name ?? 'unknown',
    }));
  } catch (err) {
    console.error('Ошибка получения календарей:', err);
    return [];
  }
}

export async function importEventsFromCalendar(
  calendarId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const token = useAuthStore.getState().token;
  if (!token) return 0;

  try {
    const events = await Calendar.getEventsAsync([calendarId], startDate, endDate);
    let importedCount = 0;

    for (const event of events) {
      const calendarEvent: CalendarEvent = {
        title: event.title,
        date: new Date(event.startDate).toISOString().split('T')[0],
        startTime: event.allDay
          ? undefined
          : new Date(event.startDate).toTimeString().slice(0, 5),
        endTime: event.allDay
          ? undefined
          : new Date(event.endDate).toTimeString().slice(0, 5),
        location: event.location ?? undefined,
        source: 'imported',
      };

      try {
        await api.post('/events', calendarEvent, token);
        importedCount++;
      } catch (err) {
        console.error('Ошибка импорта события:', event.title, err);
      }
    }

    return importedCount;
  } catch (err) {
    console.error('Ошибка чтения событий из календаря:', err);
    return 0;
  }
}

export async function exportEventToCalendar(
  event: {
    title: string;
    date: string;
    startTime?: string;
    endTime?: string;
    location?: string;
  },
  calendarId: string,
): Promise<string | null> {
  try {
    const startDate = event.startTime
      ? new Date(`${event.date}T${event.startTime}:00`)
      : new Date(`${event.date}T09:00:00`);

    const endDate = event.endTime
      ? new Date(`${event.date}T${event.endTime}:00`)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    const eventId = await Calendar.createEventAsync(calendarId, {
      title: event.title,
      startDate,
      endDate,
      location: event.location,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(Platform.OS === 'android' ? { allDay: !event.startTime } : {}),
    });

    return eventId;
  } catch (err) {
    console.error('Ошибка экспорта события в календарь:', err);
    return null;
  }
}
