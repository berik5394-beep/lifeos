import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal } from './service.js';
import { runRegistryTool } from '../../tools/index.js';
import { gatherPanelFacts } from '../robot-explain.js';

/**
 * Шаги по сделкам видны в календаре мозга (get_calendar) и в пояснении робота
 * («Календарь»/«Сегодня»). CalendarEvent НЕ создаём, GET /events не трогаем.
 * Флаг выкл. → ответы байт-в-байт прежние.
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

const NOW = new Date('2026-03-10T09:00:00Z'); // вт; не «сегодня» реальных часов
const d = (s: string) => new Date(s + 'T00:00:00Z');

async function seed(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dcal-${tag}-${Date.now()}@a.test`, name: 'C', passwordHash: 'x', timezone: 'UTC' },
  });
  const userId = u.id;
  await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: d('2026-03-10'), startTime: '10:00', endTime: '11:00' } });
  await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', nextStepDate: '2026-03-10', nextStepText: 'связаться' }, NOW);
  await createDeal(userId, { personName: 'Серик', title: 'склад', nextStepDate: '2026-03-11', nextStepText: 'спросить ответ по КП' }, NOW);
  await createDeal(userId, { personName: 'Дана', title: 'сервис', nextStepDate: '2026-03-20', nextStepText: 'встреча' }, NOW);
  return userId;
}

const EVENT = { title: 'Планёрка', date: '2026-03-10', startTime: '10:00', endTime: '11:00', location: null };

describe('сделки × календарь', () => {
  it('get_calendar: шаги в диапазоне — отдельными пунктами kind=deal_step, события как были', async () => {
    const userId = await seed('tool');
    const out = await runRegistryTool('get_calendar', { from: '2026-03-10', to: '2026-03-11' }, { userId });
    expect(out).toEqual([
      EVENT,
      { title: 'Сделка: Ахмет — связаться', date: '2026-03-10', startTime: null, endTime: null, location: null, kind: 'deal_step' },
      { title: 'Сделка: Серик — спросить ответ по КП', date: '2026-03-11', startTime: null, endTime: null, location: null, kind: 'deal_step' },
    ]);
    expect(await prisma.calendarEvent.count({ where: { userId } })).toBe(1);
  });

  it('get_calendar: флаг выкл. → только события, без kind', async () => {
    const userId = await seed('tool-off');
    process.env.FEATURE_V2_DEALS = '';
    expect(await runRegistryTool('get_calendar', { from: '2026-03-10', to: '2026-03-11' }, { userId })).toEqual([EVENT]);
  });

  it('пояснение робота: «Календарь» (3 дня) и «Сегодня» (1 день) — шаги по сделкам', async () => {
    const userId = await seed('explain');
    const cal = await gatherPanelFacts(userId, 'calendar', NOW);
    expect(cal).toContain('Шаги по сделкам: сегодня Ахмет — связаться; завтра Серик — спросить ответ по КП.');
    const today = await gatherPanelFacts(userId, 'today', NOW);
    expect(today).toContain('Шаги по сделкам: сегодня Ахмет — связаться.');
  });

  it('пояснение робота: флаг выкл. → факты как раньше', async () => {
    const userId = await seed('explain-off');
    process.env.FEATURE_V2_DEALS = '';
    const cal = await gatherPanelFacts(userId, 'calendar', NOW);
    const today = await gatherPanelFacts(userId, 'today', NOW);
    expect(cal).toEqual(['Встречи (1): сегодня 10:00 — Планёрка.']);
    expect(today.join(' ')).not.toContain('сделк');
  });

  it('«Сделки»: «сегодня» — по переданному now, не по часам сервера', async () => {
    const userId = await seed('deals-now');
    const facts = await gatherPanelFacts(userId, 'deals', NOW);
    expect(facts.join(' ')).toContain('шаг сегодня: Ахмет');
    expect(facts.join(' ')).not.toContain('просрочен');
  });

  it('нит: get_calendar — не больше 100 шагов по сделкам', async () => {
    const u = await prisma.user.create({ data: { email: `dcal-cap-${Date.now()}@a.test`, name: 'C', passwordHash: 'x', timezone: 'UTC' } });
    await prisma.deal.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({ userId: u.id, personName: `Клиент${i}`, title: 't', stage: 'new', nextStepAt: d('2026-03-10'), nextStepText: 'связаться' })),
    });
    const out = (await runRegistryTool('get_calendar', { from: '2026-03-10', to: '2026-03-10' }, { userId: u.id })) as Array<{ kind?: string }>;
    expect(out.filter((x) => x.kind === 'deal_step')).toHaveLength(100);
  });
});
