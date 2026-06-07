import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildPersonMeetingBriefs } from './meeting-impl.js';
import { localDateOnlyUTC } from '../../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Детерминированно: фиксируем «сейчас» = Алматы 12:00, событие в 13:00 (через час).
const NOW = new Date('2026-06-07T07:00:00Z');
const TODAY = localDateOnlyUTC('Asia/Almaty', NOW);
const DAY = 86_400_000;

async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'PT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('buildPersonMeetingBriefs — real prisma', () => {
  it('сегодня событие с именем клиента + дело → бриф с типом+делом', async () => {
    const u = await mkUser('pm-a@a.test');
    const e = await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Ахмет', attributes: { personType: 'client' }, lastSeenAt: new Date(NOW.getTime() - 12 * DAY) } });
    await prisma.obligation.create({ data: { userId: u, personEntityId: e.id, personName: 'Ахмет', direction: 'i_owe', kind: 'action', description: 'договор', status: 'open', source: 'manual' } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с Ахметом', date: TODAY, startTime: '13:00', source: 'manual' } });
    const briefs = await buildPersonMeetingBriefs(u, NOW);
    expect(briefs.length).toBe(1);
    expect(briefs[0].name).toBe('Ахмет');
    expect(briefs[0].type).toBe('client');
    expect(briefs[0].obligation).toBe('договор');
  });
  it('событие без матча человека → пусто', async () => {
    const u = await mkUser('pm-b@a.test');
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Ахмет', attributes: { personType: 'client' } } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Обычная встреча', date: TODAY, startTime: '13:00', source: 'manual' } });
    expect(await buildPersonMeetingBriefs(u, NOW)).toEqual([]);
  });
  it('матч есть, но НЕТ CRM-контекста → пусто (D1-гейт)', async () => {
    const u = await mkUser('pm-c@a.test');
    await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Данияр', attributes: {} } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Кофе с Данияром', date: TODAY, startTime: '13:00', source: 'manual' } });
    expect(await buildPersonMeetingBriefs(u, NOW)).toEqual([]);
  });
  it('cross-user изоляция', async () => {
    const a = await mkUser('pm-iso-a@a.test');
    const b = await mkUser('pm-iso-b@a.test');
    await prisma.entity.create({ data: { userId: a, type: 'person', name: 'Бекзат', attributes: { personType: 'investor' } } });
    await prisma.calendarEvent.create({ data: { userId: a, title: 'Звонок Бекзату', date: TODAY, startTime: '13:00', source: 'manual' } });
    expect(await buildPersonMeetingBriefs(b, NOW)).toEqual([]);
  });
});
