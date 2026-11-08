import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getHourRate, listTeam } from './time-value.js';
import { setHourRateTool } from '../tools/set-hour-rate.js';
import { setPersonTypeTool } from '../tools/set-person-type.js';
import { generateTomorrowPreview } from './proactive-notifications.js';
import { localDateOnlyUTC } from '../lib/tz.js';

/** Джарвис №3: цена часа + команда → «Завтра» с ценой встречи и «можно отдать» (поручить робот не умеет). */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const TZ = 'Asia/Almaty';
const NOW = new Date('2026-11-08T15:30:00Z'); // Алматы 20:30 — время «Завтра»
const TOMORROW = new Date(localDateOnlyUTC(TZ, NOW).getTime() + 86_400_000);
const user = async () =>
  (
    await prisma.user.create({
      data: { email: `tv-${Date.now()}-${Math.random()}@a.test`, name: 'Берик', passwordHash: 'x', timezone: TZ, settings: { keep: 1 } },
    })
  ).id;
const ctx = (userId: string) => ({ userId }) as never;

describe('цена часа', () => {
  it('названная — главнее; settings не затираются', async () => {
    const u = await user();
    const r = await setHourRateTool.handler({ rate: 20000 }, ctx(u));
    expect(r.message).toBe('Запомнил: твой час — 20 000 ₸. Буду считать, во что обходятся длинные встречи.');
    expect(await getHourRate(u, NOW)).toEqual({ rate: 20000, source: 'set' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u }, select: { settings: true } });
    expect(row.settings).toMatchObject({ keep: 1, hourRate: 20000 });
  });

  it('не названа — оценка по доходу за 3 месяца (до 500 ₸); нет дохода — null', async () => {
    const u = await user();
    expect(await getHourRate(u, NOW)).toBeNull();
    await prisma.income.create({ data: { userId: u, date: new Date(NOW.getTime() - 10 * 86_400_000), source: 'зарплата', amount: 4_800_000 } });
    // 4.8 млн / 3 мес / 160 ч = 10 000
    expect(await getHourRate(u, NOW)).toEqual({ rate: 10000, source: 'income' });
  });
});

describe('команда и «Завтра»', () => {
  it('«Айгуль — наш бухгалтер» → команда; «Завтра» с ценой длинной встречи и «можно отдать»', async () => {
    const u = await user();
    const r = await setPersonTypeTool.handler({ person: 'Айгуль', type: 'team', role: 'бухгалтер' }, ctx(u));
    expect(r.message).toBe('Запомнил: Айгуль — команда (бухгалтер).');
    expect(await listTeam(u)).toEqual([{ name: 'Айгуль', role: 'бухгалтер' }]);
    await setHourRateTool.handler({ rate: 20000 }, ctx(u));
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Совещание', date: TOMORROW, startTime: '10:00', endTime: '12:00', source: 'manual' } });
    await prisma.task.create({ data: { userId: u, title: 'Сверить акты с поставщиком', category: 'work', priority: 'medium', date: TOMORROW } });
    const [n] = await generateTomorrowPreview(u, TZ, 'Берик', NOW);
    expect(n.body).toBe(
      'Берик, завтра 1 встреча: первая в 10:00 — «Совещание» и 1 задача. ' +
        '«Совещание» — 2 ч ≈ 40 000 ₸ твоего времени. Нужно ли тебе там быть всё время? ' +
        '«Сверить акты с поставщиком» — по части Айгуль (бухгалтер): можно отдать.',
    );
  });

  it('нет цены часа и команды — «Завтра» как раньше', async () => {
    const u = await user();
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Совещание', date: TOMORROW, startTime: '10:00', endTime: '12:00', source: 'manual' } });
    const [n] = await generateTomorrowPreview(u, TZ, 'Берик', NOW);
    expect(n.body).toBe('Берик, завтра 1 встреча: первая в 10:00 — «Совещание».');
  });
});
