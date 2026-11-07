import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateEventReminders } from './proactive-notifications.js';
import { localDateOnlyUTC } from '../lib/tz.js';

/**
 * Джарвис-бриф (docs/plan/jarvis-roadmap.md №1): за час до встречи с известным
 * человеком — не «подготовься», а что обещал ты/тебе, долги, сделка, что помню.
 */
const prisma = new PrismaClient();
const saved = process.env.FEATURE_V2_PERSON_TYPES;
beforeAll(() => {
  process.env.FEATURE_V2_PERSON_TYPES = 'all'; // как в проде
});
afterAll(async () => {
  process.env.FEATURE_V2_PERSON_TYPES = saved;
  await prisma.$disconnect();
});

// Алматы 12:30 → встреча в 15:00, пуш «за час» в 14:00 ещё впереди.
const NOW = new Date('2026-11-07T07:30:00Z');
const TODAY = localDateOnlyUTC('Asia/Almaty', NOW);
const user = async () =>
  (
    await prisma.user.create({
      data: { email: `mb-${Date.now()}-${Math.random()}@a.test`, name: 'Б', passwordHash: 'x', timezone: 'Asia/Almaty' },
    })
  ).id;

describe('пуш за час до встречи', () => {
  it('встреча с Сериком → бриф: обещания, долг, что помню', async () => {
    const u = await user();
    const serik = await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик', attributes: { personType: 'client' } } });
    const obl = (direction: string, kind: string, description: string, amount?: number) =>
      prisma.obligation.create({
        data: { userId: u, personEntityId: serik.id, personName: 'Серик', direction, kind, description, amount, source: 'manual' },
      });
    await obl('i_owe', 'action', 'отправить прайс');
    await obl('owed_to_me', 'money', 'за турникеты', 200000);
    await prisma.memory.create({
      data: { userId: u, type: 'event', content: 'Обсуждали с Сериком турникеты для склада', source: 'chat', tags: [], entityRefs: [serik.id] },
    });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с Сериком', date: TODAY, startTime: '15:00', source: 'manual' } });

    const n = (await generateEventReminders(u, NOW)).find((x) => x.type === 'event_reminder_1h');
    expect(n?.title).toBe('Через час: Встреча с Сериком');
    expect(n?.body).toBe(
      'Серик (клиент). Твоё обещание: «отправить прайс». Тебе должны 200 000 ₸. Помню: «Обсуждали с Сериком турникеты для склада».',
    );
  });

  it('о человеке ничего не известно — обычное напоминание, без выдумок', async () => {
    const u = await user();
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с поставщиком', date: TODAY, startTime: '15:00', source: 'manual' } });
    const n = (await generateEventReminders(u, NOW)).find((x) => x.type === 'event_reminder_1h');
    expect(n).toMatchObject({ title: 'Скоро встреча', body: 'Через час встреча: Встреча с поставщиком. Подготовься!' });
  });

  it('«Неправда» в памяти — в бриф не попадает', async () => {
    const u = await user();
    const serik = await prisma.entity.create({ data: { userId: u, type: 'person', name: 'Серик' } });
    await prisma.memory.create({
      data: { userId: u, type: 'fact', content: 'Серик любит кофе', source: 'chat', tags: [], entityRefs: [serik.id], invalidAt: new Date(NOW.getTime() - 1000) },
    });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Кофе с Сериком', date: TODAY, startTime: '15:00', source: 'manual' } });
    const n = (await generateEventReminders(u, NOW)).find((x) => x.type === 'event_reminder_1h');
    expect(n?.body).toBe('Через час встреча: Кофе с Сериком. Подготовься!');
  });
});
