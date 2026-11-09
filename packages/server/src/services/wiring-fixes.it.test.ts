import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { journalRoutes } from '../routes/journal.js';
import { visionRoutes } from '../routes/vision.js';
import { financeRoutes } from '../routes/finance.js';
import { addCivilDays, localDateStr } from '../lib/tz.js';

/**
 * Проводка (аудит 2026-11-08) — настоящие роуты и тест-БД:
 *  - сон из «Здоровья» не забирает дневную монету дневника;
 *  - расписание с фото раскладывается по дням недели, время — начало пары;
 *  - задачи с фото — с проверкой наложения;
 *  - финансовый совет честный (категории по-русски, без «всё в порядке» без лимитов).
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([journalRoutes, visionRoutes, financeRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
async function user(tag: string) {
  const u = await prisma.user.create({ data: { email: `wire-${tag}-${Date.now()}@a.test`, name: 'W', passwordHash: 'x', timezone: 'UTC' } });
  return { userId: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
}
const TODAY = localDateStr('UTC', new Date());
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('сон из «Здоровья» ≠ запись в дневнике', () => {
  it('синк сна — без монеты; потом ручная запись — монета есть (не украдена)', async () => {
    const { userId, headers } = await user('sleep');
    const h = await app.inject({ method: 'POST', url: '/journal', headers, payload: { date: TODAY, sleepHours: 7.5, source: 'health' } });
    expect(h.statusCode).toBe(200);
    expect(h.json().sleepHours).toBe(7.5);
    await settle();
    expect(await prisma.coinTransaction.count({ where: { userId, reason: 'Запись в дневнике' } })).toBe(0);

    await app.inject({ method: 'POST', url: '/journal', headers, payload: { date: TODAY, mood: 7, notes: 'хороший день' } });
    await settle();
    expect(await prisma.coinTransaction.count({ where: { userId, reason: 'Запись в дневнике' } })).toBe(1);
  });
});

describe('расписание с фото', () => {
  it('«Понедельник»/«Среда» → ближайшие такие дни; «9:00–10:30» → 09:00', async () => {
    const { userId, headers } = await user('sched');
    const r = await app.inject({
      method: 'POST', url: '/vision/import-schedule', headers,
      payload: { items: [{ day: 'Понедельник', time: '9:00–10:30', subject: 'Математика' }, { day: 'Среда', time: '11.15', subject: 'Физика' }, { subject: 'Без дня' }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().created).toBe(3);
    const tasks = await prisma.task.findMany({ where: { userId }, select: { title: true, date: true, time: true } });
    const by = (t: string) => tasks.find((x) => x.title === t)!;
    expect(by('Математика').date.getUTCDay()).toBe(1);
    expect(by('Физика').date.getUTCDay()).toBe(3);
    expect(by('Математика').time).toBe('09:00');
    expect(by('Физика').time).toBe('11:15');
    expect(by('Без дня').date.toISOString().slice(0, 10)).toBe(TODAY);
    for (const t of [by('Математика'), by('Физика')]) {
      const d = t.date.toISOString().slice(0, 10);
      expect(d >= TODAY && d <= addCivilDays(TODAY, 6)).toBe(true);
    }
  });
});

describe('задачи с фото', () => {
  it('задача поверх встречи → conflictWarning в ответе', async () => {
    const { userId, headers } = await user('cap');
    await prisma.calendarEvent.create({ data: { userId, title: 'Планёрка', date: new Date(`${TODAY}T00:00:00Z`), startTime: '10:00', endTime: '11:00' } });
    const r = await app.inject({
      method: 'POST', url: '/vision/save-captured-tasks', headers,
      payload: { tasks: [{ title: 'Позвонить', time: '10:30' }, { title: 'Купить хлеб' }] },
    });
    expect(r.json().created).toBe(2);
    expect(r.json().conflictWarning).toBe('«Позвонить»: накладывается на время с встречей «Планёрка» 10:00–11:00.');
  });
});

describe('финансовый совет', () => {
  it('без лимитов — пусто (раньше «Финансы в порядке» без данных)', async () => {
    const { headers } = await user('nolim');
    expect((await app.inject({ method: 'GET', url: '/finance/advice', headers })).json().advice).toBe('');
  });
  it('категории по-русски; «по N в день» — только из категорий с лимитом', async () => {
    const { userId, headers } = await user('lim');
    const [y, m] = TODAY.split('-').map(Number);
    await prisma.budgetLimit.create({ data: { userId, category: 'food', monthlyLimit: 10000, month: m, year: y } });
    await prisma.expense.create({ data: { userId, date: new Date(`${TODAY}T00:00:00Z`), category: 'food', description: 'еда', amount: 9000 } });
    await prisma.expense.create({ data: { userId, date: new Date(`${TODAY}T00:00:00Z`), category: 'transport', description: 'такси', amount: 50000 } });
    const a = (await app.inject({ method: 'GET', url: '/finance/advice', headers })).json();
    expect(a.advice).toContain('«Еда»: 90% лимита.');
    expect(a.advice).not.toContain('food');
    expect(a.dailyBudget).toBeGreaterThan(0); // такси без лимита не съело лимит еды
  });
});

import { afterBulkTasksCreated } from './bulk-tasks.js';
import { peekPendingAction } from './pending-actions.js';
describe('находки ревью проводки', () => {
  it('диктовка (checks:false) — без невидимого предложения сдвига', async () => {
    const { userId } = await user('dict');
    const d = new Date(`${TODAY}T00:00:00Z`);
    const tasks = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        prisma.task.create({ data: { userId, title: `Дело ${i}`, category: 'work', priority: 'low', date: d, estimatedMinutes: 120 }, select: { id: true, title: true, date: true, time: true } }),
      ),
    );
    expect(await afterBulkTasksCreated(userId, tasks, { checks: false })).toEqual({});
    expect(await peekPendingAction(userId)).toBeNull();
  });

  it('расписание больше 100 пунктов → 400 (не неограниченная запись)', async () => {
    const { headers } = await user('big');
    const items = Array.from({ length: 101 }, (_, i) => ({ subject: `Урок ${i}` }));
    expect((await app.inject({ method: 'POST', url: '/vision/import-schedule', headers, payload: { items } })).statusCode).toBe(400);
  });

  it('совет: «по N в день, считая сегодня»; дни — как плитка экрана (без сегодня)', async () => {
    const { userId, headers } = await user('days');
    const [y, m, dd] = TODAY.split('-').map(Number);
    await prisma.budgetLimit.create({ data: { userId, category: 'food', monthlyLimit: 30000, month: m, year: y } });
    const a = (await app.inject({ method: 'GET', url: '/finance/advice', headers })).json();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    expect(a.daysRemaining).toBe(daysInMonth - dd);
    expect(a.dailyBudget).toBe(Math.round(30000 / (daysInMonth - dd + 1)));
    expect(a.advice).toContain('считая сегодня');
  });
});
