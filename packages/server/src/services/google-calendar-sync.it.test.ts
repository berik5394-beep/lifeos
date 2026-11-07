import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Google замокан: проверяем, что встречи доходят до мозга (CalendarEvent) без дублей.
const listEvents = vi.fn();
const insertEvent = vi.fn();
vi.mock('./google-calendar.js', () => ({
  getFreshGoogleAccessToken: async () => 'access',
  listEvents: (...a: unknown[]) => listEvents(...a),
  insertEvent: (...a: unknown[]) => insertEvent(...a),
}));
const { syncGoogleCalendar } = await import('./google-calendar-sync.js');

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const NOW = new Date('2026-11-07T06:00:00Z');

describe('синхронизация Google Calendar (кнопка и планировщик — одно тело)', () => {
  it('новая встреча из Google → в календарь мозга; повтор не дублирует; своя встреча уходит в Google', async () => {
    const u = await prisma.user.create({ data: { email: `gs-${Date.now()}-${Math.random()}@a.test`, name: 'G', passwordHash: 'x', timezone: 'Asia/Almaty' } });
    const remote = [{ externalId: 'g1', title: 'Встреча с Сериком', date: '2026-11-08', startTime: '14:00', endTime: '15:00', location: null, description: null }];
    listEvents.mockResolvedValue(remote);
    insertEvent.mockResolvedValue('g-local-1');
    await prisma.calendarEvent.create({ data: { userId: u.id, title: 'Стоматолог', date: new Date('2026-11-09T00:00:00Z'), startTime: '10:00', source: 'manual' } });

    expect(await syncGoogleCalendar(u.id, NOW)).toEqual({ imported: 1, exported: 1 });
    expect(await syncGoogleCalendar(u.id, NOW)).toEqual({ imported: 0, exported: 0 });

    const events = await prisma.calendarEvent.findMany({ where: { userId: u.id }, orderBy: { date: 'asc' } });
    expect(events.map((e) => [e.title, e.source, e.externalId])).toEqual([
      ['Встреча с Сериком', 'google', 'g1'],
      ['Стоматолог', 'manual', 'g-local-1'],
    ]);
  });
});
