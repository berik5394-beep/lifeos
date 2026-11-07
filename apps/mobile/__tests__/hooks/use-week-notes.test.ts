import { storage } from '@/services/storage';
import { loadWeekNotes, weekNotesKey } from '@/hooks/use-week-notes';

describe('заметки недели хранятся на телефоне', () => {
  it('сохранённое за неделю читается обратно; другая неделя — пусто', () => {
    storage.set(weekNotesKey('2026-11-02'), JSON.stringify({ notes: 'Сдать отчёт', gratitude: 'маме' }));
    expect(loadWeekNotes('2026-11-02')).toEqual({ notes: 'Сдать отчёт', improve: '', gratitude: 'маме' });
    expect(loadWeekNotes('2026-11-09')).toEqual({ notes: '', improve: '', gratitude: '' });
  });
  it('битая запись не роняет экран', () => {
    storage.set(weekNotesKey('2026-11-16'), '{не json');
    expect(loadWeekNotes('2026-11-16')).toEqual({ notes: '', improve: '', gratitude: '' });
  });
});
