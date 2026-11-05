import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'assistant-service.ts'), 'utf8');

/**
 * Review-catch (d67417d): gatherAssistantContext — живой читатель task/event,
 * остался на старом localDayStartUTC после миграции записи на convA → терял
 * сегодняшние задачи/события для Almaty. Фиксируем две конвенции структурно
 * (behavioral путь зовёт внешние API → флак без ключей).
 */
describe('assistant-service: @db.Date конвенции (review-catch d67417d)', () => {
  it('task/event И habitLog читаются через convA (localDateOnlyUTC) — habit-day 2026-11-05', () => {
    // convA для task/event
    expect(SRC).toContain('localDateOnlyUTC');
    expect(SRC).toContain('todayDateOnly = localDateOnlyUTC');
    expect(SRC).toContain('date: todayDateOnly, cancelled');
    expect(SRC).toContain('gte: todayDateOnly, lt: tomorrowDateOnly');
    expect(SRC).toContain('calculateWeekProgress(userId, todayDateOnly)');
    // habit-day: привычки пишутся календарной датой (complete-habit и приложение)
    // → читаются той же convA; старая convB (localDayStartUTC) не должна вернуться.
    expect(SRC).toContain('date: todayDateOnly, completed: true');
    expect(SRC).not.toContain('localDayStartUTC');
  });

  it('старый tomorrow-через-localDayStartUTCOffset для event-окна убран', () => {
    expect(SRC).not.toContain('localDayStartUTCOffset');
    expect(SRC).not.toContain('date: { gte: today, lt: tomorrow }');
  });
});
