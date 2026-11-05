import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * habit-day (2026-11-05): HabitLog.date = календарная дата юзера (convA).
 * localDayStartUTC (реальный инстант локальной полуночи) в @db.Date для UTC+
 * зон даёт ВЧЕРА — не должен вернуться в писатели/читатели «сегодня» привычек.
 * (localDayStartUTC законен только для таймстемпов: createdAt, время напоминаний.)
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

describe('habit-day guard — привычки только календарной датой', () => {
  it.each([
    'src/tools/complete-habit.ts',
    'src/tools/complete-multiple-habits.ts',
    'src/services/open-loops.ts',
    'src/services/assistant-service.ts',
  ])('%s не использует localDayStartUTC', (f) => {
    expect(read(f)).not.toMatch(/localDayStartUTC/);
  });
  it.each(['src/routes/pet.ts', 'src/routes/briefing.ts', 'src/routes/notifications.ts', 'src/services/streak-service.ts'])(
    '%s: «сегодня» не из полуночи сервера',
    (f) => {
      expect(read(f)).not.toMatch(/setHours\(0, 0, 0, 0\)[\s\S]{0,200}habitLog|new Date\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\)\)/);
      expect(read(f)).toMatch(/localDateOnlyUTC/);
    },
  );
});
