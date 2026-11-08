import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildWidgetToday } from './widget.js';
import { localDateOnlyUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const TZ = 'Asia/Almaty';
const NOW = new Date('2026-11-08T07:00:00Z'); // Алматы 12:00
const TODAY = localDateOnlyUTC(TZ, NOW);

describe('виджет «Сегодня»', () => {
  it('задачи, привычки, ближайшая встреча, главная задача', async () => {
    const u = (await prisma.user.create({ data: { email: `wg-${Date.now()}@a.test`, name: 'A', passwordHash: 'x', timezone: TZ } })).id;
    const t = (title: string, completed: boolean, priority = 'medium') =>
      prisma.task.create({ data: { userId: u, title, category: 'work', priority, date: TODAY, completed } });
    await t('Отчёт', true);
    await t('Купить хлеб', false, 'low');
    await t('Позвонить Серику', false, 'high');
    const h1 = await prisma.habit.create({ data: { userId: u, name: 'Чтение', category: 'personal', frequency: 'daily' } });
    await prisma.habit.create({ data: { userId: u, name: 'Бег', category: 'health', frequency: 'daily' } });
    await prisma.habitLog.create({ data: { userId: u, habitId: h1.id, date: TODAY, completed: true } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Планёрка', date: TODAY, startTime: '09:00', source: 'manual' } });
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с Сериком', date: TODAY, startTime: '15:00', source: 'manual' } });
    expect(await buildWidgetToday(u, NOW)).toEqual({
      date: TODAY.toISOString().slice(0, 10),
      tasksDone: 1,
      tasksTotal: 3,
      habitsDone: 1,
      habitsTotal: 2,
      next: { time: '15:00', title: 'Встреча с Сериком' },
      topTask: 'Позвонить Серику',
    });
  });
});
