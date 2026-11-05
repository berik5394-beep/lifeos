import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../../test/integration/build-test-app.js';
import { briefingRoutes } from '../../routes/briefing.js';
import { notificationRoutes } from '../../routes/notifications.js';
import { buildMorning } from '../proactive-notifications.js';
import { localDateStr } from '../../lib/tz.js';
import { createDeal, dealStepsTodayLabels } from './service.js';

/**
 * Утро: шаги по сделкам на сегодня — в брифинге (GET /briefing/morning,
 * GET /notifications/briefing), в утреннем пуше и в контексте робота.
 * Флаг выкл. → ключей нет, тело пуша байт-в-байт прежнее.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
const ORIG = process.env.FEATURE_V2_DEALS;
beforeAll(async () => {
  app = await buildTestApp([briefingRoutes, notificationRoutes]);
});
afterAll(async () => {
  if (ORIG === undefined) delete process.env.FEATURE_V2_DEALS;
  else process.env.FEATURE_V2_DEALS = ORIG;
  await app.close();
  await prisma.$disconnect();
});
afterEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });
process.env.FEATURE_V2_DEALS = 'all';

const TODAY = localDateStr('UTC');
const d = (s: string) => new Date(s + 'T00:00:00Z');
const tomorrow = () => new Date(d(TODAY).getTime() + 86_400_000).toISOString().slice(0, 10);

async function seed(tag: string, names: string[] = ['Ахмет']) {
  const u = await prisma.user.create({
    data: { email: `dmorn-${tag}-${Date.now()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC' },
  });
  const userId = u.id;
  await prisma.task.create({ data: { userId, title: 'Отчёт', category: 'work', priority: 'medium', date: d(TODAY) } });
  await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: d(TODAY), startTime: '10:00', endTime: '11:00' } });
  const texts: Record<string, string> = { Ахмет: 'связаться', Серик: 'отправить КП', Дана: 'встреча', Аля: 'созвон' };
  const ids: string[] = [];
  for (const n of names) {
    ids.push((await createDeal(userId, { personName: n, title: 'сделка ' + n, nextStepDate: TODAY, nextStepText: texts[n] })).deal.id);
  }
  await createDeal(userId, { personName: 'Марат', title: 'завтрашняя', nextStepDate: tomorrow(), nextStepText: 'позвонить' });
  return { userId, ids, headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` } };
}

const MORNING_KEYS = ['date', 'quote', 'tasks', 'events', 'habits', 'budget', 'streak', 'steps', 'dayProgress'];
const NOTIF_KEYS = ['tasks', 'events', 'habitsProgress', 'streak', 'quote', 'budgetStatus'];

describe('утро × сделки', () => {
  it('GET /briefing/morning: deals — шаги на сегодня', async () => {
    const { ids, headers } = await seed('brief');
    const body = (await app.inject({ method: 'GET', url: '/briefing/morning', headers })).json();
    expect(body.deals).toEqual({
      items: [{ id: ids[0], personName: 'Ахмет', title: 'сделка Ахмет', nextStepText: 'связаться' }],
      total: 1,
    });
  });

  it('GET /briefing/morning: флаг выкл. → ключа deals нет, ключи как раньше', async () => {
    const { headers } = await seed('brief-off');
    process.env.FEATURE_V2_DEALS = '';
    const body = (await app.inject({ method: 'GET', url: '/briefing/morning', headers })).json();
    expect(Object.keys(body)).toEqual(MORNING_KEYS);
  });

  it('GET /notifications/briefing: dealSteps на сегодня; флаг выкл. → ключа нет', async () => {
    const { ids, headers } = await seed('notif');
    const on = (await app.inject({ method: 'GET', url: '/notifications/briefing', headers })).json();
    expect(on.dealSteps).toEqual([{ id: ids[0], personName: 'Ахмет', title: 'сделка Ахмет', nextStepText: 'связаться', date: TODAY }]);
    process.env.FEATURE_V2_DEALS = '';
    const off = (await app.inject({ method: 'GET', url: '/notifications/briefing', headers })).json();
    expect(Object.keys(off)).toEqual(NOTIF_KEYS);
  });

  it('утренний пуш: после встреч — шаги по сделкам (до 3 имён)', async () => {
    const { userId } = await seed('push', ['Ахмет', 'Серик', 'Дана', 'Аля']);
    const [n] = await buildMorning(userId, 'Берик', new Date(), 'UTC');
    expect(n.body).toBe(
      '1 задача на сегодня, 1 встреча (первая в 10:00 — «Планёрка»), ' +
        '4 шага по сделкам: Ахмет — связаться; Серик — отправить КП; Дана — встреча и ещё 1. Начнём?',
    );
  });

  it('утренний пуш: флаг выкл. → тело как раньше', async () => {
    const { userId } = await seed('push-off', ['Ахмет', 'Серик']);
    process.env.FEATURE_V2_DEALS = '';
    const [n] = await buildMorning(userId, 'Берик', new Date(), 'UTC');
    expect(n.body).toBe('1 задача на сегодня, 1 встреча (первая в 10:00 — «Планёрка»). Начнём?');
  });

  it('контекст робота: подписи шагов на сегодня; флаг выкл. → undefined', async () => {
    const { userId } = await seed('ctx', ['Ахмет', 'Серик']);
    expect(await dealStepsTodayLabels(userId, d(TODAY))).toEqual(['Ахмет — связаться', 'Серик — отправить КП']);
    process.env.FEATURE_V2_DEALS = '';
    expect(await dealStepsTodayLabels(userId, d(TODAY))).toBeUndefined();
  });

  it('нит: утренний пуш — длинный шаг обрезан до ~60 символов', async () => {
    const u = await prisma.user.create({ data: { email: `dmorn-long-${Date.now()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: 'UTC' } });
    const long = 'позвонить и обсудить '.repeat(10).trim();
    await createDeal(u.id, { personName: 'Ахмет', title: 'склад', nextStepDate: TODAY, nextStepText: long });
    const [n] = await buildMorning(u.id, 'Берик', new Date(), 'UTC');
    const m = n.body.match(/по сделкам: (.*)\. Начнём\?$/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(60);
    expect(m![1].startsWith('Ахмет — позвонить и обсудить')).toBe(true);
    expect(m![1].endsWith('…')).toBe(true);
  });
});
