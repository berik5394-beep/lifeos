import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { generateTomorrowPreview, tomorrowPreviewText } from './proactive-notifications.js';
import { localDateOnlyUTC } from '../lib/tz.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Berik: «юзер должен знать заранее о встрече и своём графике». В 20:00 по
// местному времени — что ждёт завтра.
describe('tomorrowPreviewText', () => {
  it('встречи: число, первая по времени, ранний старт', () => {
    const t = tomorrowPreviewText('Лейла', [
      { title: 'Обед с Сериком', startTime: '13:00' },
      { title: 'Созвон с банком', startTime: '09:30' },
    ], 4);
    expect(t).toBe('Лейла, завтра 2 встречи: первая в 09:30 — «Созвон с банком» и 4 задачи. Начало раннее — ложись пораньше.');
  });
  it('только задачи', () => {
    expect(tomorrowPreviewText('Лейла', [], 1)).toBe('Лейла, завтра 1 задача.');
  });
  it('пусто — ничего', () => {
    expect(tomorrowPreviewText('Лейла', [], 0)).toBeNull();
  });
});

describe('generateTomorrowPreview (тест-БД)', () => {
  const tz = 'Asia/Almaty';
  async function mk() {
    return (await prisma.user.create({ data: { email: `tp-${Date.now()}-${Math.random()}@a.test`, name: 'Лейла', passwordHash: 'x', timezone: tz } })).id;
  }
  const late = new Date(Date.now() + 24 * 3_600_000); // точно после 20:00 сегодняшнего слота

  it('после 20:00 — встреча завтра в тексте; до 20:00 — пусто', async () => {
    const u = await mk();
    const tomorrow = new Date(localDateOnlyUTC(tz).getTime() + 86_400_000);
    await prisma.calendarEvent.create({ data: { userId: u, title: 'Встреча с Ахметом', date: tomorrow, startTime: '10:00' } });
    const [n] = await generateTomorrowPreview(u, tz, 'Лейла', late);
    expect(n.type).toBe('tomorrow_preview');
    expect(n.body).toContain('завтра 1 встреча: первая в 10:00 — «Встреча с Ахметом»');
    expect(await generateTomorrowPreview(u, tz, 'Лейла', new Date(0))).toEqual([]);
  });

  it('на завтра ничего — уведомления нет', async () => {
    const u = await mk();
    expect(await generateTomorrowPreview(u, tz, 'Лейла', late)).toEqual([]);
  });
});
