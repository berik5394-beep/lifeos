/**
 * Двусторонняя синхронизация Google Calendar ↔ CalendarEvent.
 * Раньше жила внутри маршрута и шла ТОЛЬКО по ручной кнопке — встречи,
 * добавленные в Google, мозг не видел, пока юзер сам не нажмёт «Синхронизировать».
 * Теперь одно тело для кнопки и планировщика (раз в час на юзера).
 */
import { prisma } from '../lib/prisma.js';
import { getFreshGoogleAccessToken, listEvents, insertEvent } from './google-calendar.js';

/** Горизонт подтягивания встреч из Google. */
const HORIZON_DAYS = 30;
/** Плановая синхронизация — не чаще раза в столько. */
export const GOOGLE_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export async function syncGoogleCalendar(
  userId: string,
  now: Date = new Date(),
): Promise<{ imported: number; exported: number }> {
  const accessToken = await getFreshGoogleAccessToken(userId);
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  // 1. PULL: Google → CalendarEvent (дедуп по externalId).
  const remote = await listEvents(accessToken, now.toISOString(), horizon.toISOString());
  let imported = 0;
  for (const ev of remote) {
    const existing = await prisma.calendarEvent.findFirst({
      where: { userId, externalId: ev.externalId },
      select: { id: true },
    });
    const evData = {
      title: ev.title.slice(0, 512),
      date: new Date(ev.date + 'T00:00:00Z'),
      startTime: ev.startTime,
      endTime: ev.endTime,
      location: ev.location?.slice(0, 512) ?? null,
      description: ev.description?.slice(0, 4096) ?? null,
      source: 'google',
    };
    if (existing) {
      await prisma.calendarEvent.update({ where: { id: existing.id }, data: evData });
    } else {
      await prisma.calendarEvent.create({ data: { userId, externalId: ev.externalId, ...evData } });
      imported++;
    }
  }

  // 2. PUSH: локальные (manual/voice, ещё не в Google) → Google.
  const localUnsynced = await prisma.calendarEvent.findMany({
    where: {
      userId,
      externalId: null,
      source: { in: ['manual', 'voice'] },
      date: { gte: new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z') },
    },
    take: 100,
  });
  let exported = 0;
  for (const ev of localUnsynced) {
    const gid = await insertEvent(accessToken, {
      title: ev.title,
      date: ev.date.toISOString().slice(0, 10),
      startTime: ev.startTime,
      endTime: ev.endTime,
      location: ev.location,
      description: ev.description,
    });
    await prisma.calendarEvent.update({ where: { id: ev.id }, data: { externalId: gid } });
    exported++;
  }
  return { imported, exported };
}
