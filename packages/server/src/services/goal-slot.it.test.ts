import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { findUpcomingSlot } from './goal-slot.js';
import { localDateStr } from '../lib/tz.js';

// Pattern from open-loops.it.test.ts: own PrismaClient, disconnect in afterAll.
// Каждый it-блок стартует на чистой БД (setup.ts → beforeEach → resetDb).
const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

const TZ = 'Asia/Almaty';

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `it-gslot-${tag}@it.local`,
      name: 'IT',
      passwordHash: 'x',
      timezone: TZ,
    },
  });
  return u.id;
}

// civil «сегодня+N дней» В TZ ЮЗЕРА — тем же хелпером, что findUpcomingSlot
function civilPlus(days: number, now = new Date()): string {
  return localDateStr(TZ, new Date(now.getTime() + days * 86_400_000));
}

describe('findUpcomingSlot', () => {
  it('пустой календарь → слот завтра 09:00 (полное окно 660 мин)', async () => {
    const uid = await mkUser(`e-${Date.now()}`);
    const now = new Date();
    const slot = await findUpcomingSlot(uid, now);
    expect(slot).not.toBeNull();
    expect(slot!.date).toBe(civilPlus(1, now));
    expect(slot!.from).toBe('09:00');
    expect(slot!.durationMinutes).toBe(660);
  });

  it('завтра занято целиком → слот послезавтра', async () => {
    const uid = await mkUser(`b-${Date.now()}`);
    const now = new Date();
    await prisma.calendarEvent.create({
      data: {
        userId: uid,
        title: 'весь день',
        date: new Date(civilPlus(1, now) + 'T00:00:00Z'),
        startTime: '09:00',
        endTime: '20:00',
      },
    });
    const slot = await findUpcomingSlot(uid, now);
    expect(slot).not.toBeNull();
    expect(slot!.date).toBe(civilPlus(2, now));
  });

  it('cross-user: чужие события не влияют', async () => {
    const u1 = await mkUser(`x1-${Date.now()}`);
    const u2 = await mkUser(`x2-${Date.now()}`);
    const now = new Date();
    await prisma.calendarEvent.create({
      data: {
        userId: u2,
        title: 'чужое',
        date: new Date(civilPlus(1, now) + 'T00:00:00Z'),
        startTime: '09:00',
        endTime: '20:00',
      },
    });
    const slot = await findUpcomingSlot(u1, now);
    expect(slot!.date).toBe(civilPlus(1, now));
  });
});
