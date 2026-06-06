import { describe, it, expect } from 'vitest';
import { hmToMinutes, detectConflicts, formatScheduleConflict } from './types.js';

describe('hmToMinutes', () => {
  it('валидное HH:MM → минуты', () => {
    expect(hmToMinutes('14:30')).toBe(870);
    expect(hmToMinutes('00:00')).toBe(0);
    expect(hmToMinutes('23:59')).toBe(1439);
  });
  it('невалидное → null', () => {
    expect(hmToMinutes('24:00')).toBeNull();
    expect(hmToMinutes('12:60')).toBeNull();
    expect(hmToMinutes('abc')).toBeNull();
    expect(hmToMinutes('14')).toBeNull();
  });
});

describe('detectConflicts', () => {
  const ev = (startTime: string, endTime: string | null = null, title = 'Встреча'): { title: string; startTime: string; endTime: string | null } => ({ title, startTime, endTime });

  it('задача внутри окна встречи → конфликт', () => {
    const c = detectConflicts([{ title: 'Отчёт', time: '14:30' }], [ev('14:00', '15:00')]);
    expect(c).toHaveLength(1);
    expect(c[0].taskTitle).toBe('Отчёт');
    expect(c[0].eventTitle).toBe('Встреча');
  });

  it('задача вне окна → нет конфликта', () => {
    expect(detectConflicts([{ title: 'X', time: '09:00' }], [ev('14:00', '15:00')])).toHaveLength(0);
  });

  it('встреча без endTime → дефолт-окно 60 мин', () => {
    expect(detectConflicts([{ title: 'X', time: '14:30' }], [ev('14:00', null)])).toHaveLength(1);
    expect(detectConflicts([{ title: 'X', time: '15:30' }], [ev('14:00', null)])).toHaveLength(0);
  });

  it('конец окна эксклюзивен (task == end → не конфликт)', () => {
    expect(detectConflicts([{ title: 'X', time: '15:00' }], [ev('14:00', '15:00')])).toHaveLength(0);
    expect(detectConflicts([{ title: 'X', time: '14:00' }], [ev('14:00', '15:00')])).toHaveLength(1);
  });

  it('невалидное время задачи/события → пропуск', () => {
    expect(detectConflicts([{ title: 'X', time: 'bad' }], [ev('14:00', '15:00')])).toHaveLength(0);
    expect(detectConflicts([{ title: 'X', time: '14:30' }], [ev('bad', null)])).toHaveLength(0);
  });
});

describe('formatScheduleConflict', () => {
  it('конфликты → секция с предупреждением', () => {
    const s = formatScheduleConflict([
      { taskTitle: 'Отчёт', taskTime: '14:30', eventTitle: 'Серик', eventStart: '14:00', eventEnd: '15:00' },
    ]);
    expect(s).toContain('⚠️ Конфликт');
    expect(s).toContain('Отчёт');
    expect(s).toContain('Серик');
    expect(s).toContain('14:00–15:00');
  });
  it('пусто → пустая строка', () => {
    expect(formatScheduleConflict([])).toBe('');
  });
});
