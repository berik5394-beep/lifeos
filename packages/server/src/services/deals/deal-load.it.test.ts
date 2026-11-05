import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal, updateDeal } from './service.js';
import { gatherDayLoad } from '../day-load.js';
import { gatherWeekLoad } from '../week-load.js';
import { gatherMonthLoad } from '../month-load.js';

/**
 * Шаг по сделке — обещание клиенту: он ест время дня/недели/месяца (20 мин,
 * важность 3 — не вылетает из fit). Флаг выкл. → нагрузка байт-в-байт прежняя.
 */
const prisma = new PrismaClient();
const ORIG = process.env.FEATURE_V2_DEALS;
afterAll(async () => {
  if (ORIG === undefined) delete process.env.FEATURE_V2_DEALS;
  else process.env.FEATURE_V2_DEALS = ORIG;
  await prisma.$disconnect();
});
afterEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });
process.env.FEATURE_V2_DEALS = 'all';

const NOW = new Date('2026-11-05T09:00:00Z'); // чт; неделя 02.11–08.11
const d = (s: string) => new Date(s + 'T00:00:00Z');

async function seed(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dload-${tag}-${Date.now()}@a.test`, name: 'L', passwordHash: 'x', timezone: 'UTC' },
  });
  const userId = u.id;
  await prisma.task.create({
    data: { userId, title: 'Отчёт', category: 'work', priority: 'medium', date: d('2026-11-05'), estimatedMinutes: 30 },
  });
  await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', nextStepDate: '2026-11-05', nextStepText: 'связаться' }, NOW);
  await createDeal(userId, { personName: 'Серик', title: 'склад', nextStepDate: '2026-11-07', nextStepText: 'спросить ответ по КП' }, NOW);
  await createDeal(userId, { personName: 'Дана', title: 'сервис', nextStepDate: '2026-11-20', nextStepText: 'встреча' }, NOW);
  // закрытая — не нагрузка
  const lost = await createDeal(userId, { personName: 'Аля', title: 'x', nextStepDate: '2026-11-05' }, NOW);
  await updateDeal(userId, lost.deal.id, { stage: 'lost' }, NOW);
  return userId;
}

const TASK = { label: 'Отчёт', demand: 30, importance: 2 };
const step = (label: string) => ({ label, demand: 20, importance: 3 });

describe('шаги по сделкам × нагрузка дня/недели/месяца', () => {
  it('день: шаг на сегодня — в нагрузке (20 мин, важность 3)', async () => {
    const userId = await seed('day');
    const { items } = await gatherDayLoad(userId, NOW);
    expect(items).toEqual([TASK, step('Ахмет — связаться')]);
  });

  it('неделя и месяц: шаги в окне', async () => {
    const userId = await seed('wm');
    expect((await gatherWeekLoad(userId, NOW)).items).toEqual([
      TASK, step('Ахмет — связаться'), step('Серик — спросить ответ по КП'),
    ]);
    expect((await gatherMonthLoad(userId, NOW)).items).toEqual([
      TASK, step('Ахмет — связаться'), step('Серик — спросить ответ по КП'), step('Дана — встреча'),
    ]);
  });

  it('флаг выкл. → нагрузка как раньше (только задачи)', async () => {
    const userId = await seed('off');
    process.env.FEATURE_V2_DEALS = '';
    const day = await gatherDayLoad(userId, NOW);
    const week = await gatherWeekLoad(userId, NOW);
    const month = await gatherMonthLoad(userId, NOW);
    expect(day.items).toEqual([TASK]);
    expect(week.items).toEqual([TASK]);
    expect(month.items).toEqual([TASK]);
    process.env.FEATURE_V2_DEALS = 'all';
    // ёмкость от сделок не зависит
    expect((await gatherDayLoad(userId, NOW)).capacity).toBe(day.capacity);
    expect((await gatherWeekLoad(userId, NOW)).capacity).toBe(week.capacity);
  });
});
