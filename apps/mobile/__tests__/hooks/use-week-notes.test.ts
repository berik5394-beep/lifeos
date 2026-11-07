import { storage } from '@/services/storage';
import { loadWeekNotes, weekNotesKey, mondayKey, mergeWeekNotes } from '@/hooks/use-week-notes';

describe('заметки недели хранятся на телефоне', () => {
  it('сохранённое за неделю читается обратно; другая неделя — пусто', () => {
    storage.set(weekNotesKey('2026-11-02'), JSON.stringify({ notes: 'Сдать отчёт', gratitude: 'маме' }));
    expect(loadWeekNotes('2026-11-02')).toEqual({ notes: 'Сдать отчёт', improve: '', gratitude: 'маме', wins: '' });
    expect(loadWeekNotes('2026-11-09')).toEqual({ notes: '', improve: '', gratitude: '', wins: '' });
  });
  it('битая запись не роняет экран', () => {
    storage.set(weekNotesKey('2026-11-16'), '{не json');
    expect(loadWeekNotes('2026-11-16')).toEqual({ notes: '', improve: '', gratitude: '', wins: '' });
  });
});

describe('ключ недели', () => {
  it('понедельник для любого дня, воскресенье — к прошлому понедельнику', () => {
    expect(mondayKey(new Date(2026, 10, 7))).toBe('2026-11-02'); // суббота
    expect(mondayKey(new Date(2026, 10, 8))).toBe('2026-11-02'); // воскресенье
    expect(mondayKey(new Date(2026, 10, 9))).toBe('2026-11-09'); // понедельник
  });
});

describe('синхронизация заметок недели с сервером (мозг их видит)', () => {
  const E = { notes: '', improve: '', gratitude: '', wins: '' };
  it('набранное на телефоне главнее; разница уезжает на сервер', () => {
    const { merged, toPush } = mergeWeekNotes({ ...E, wins: 'новое' }, { ...E, wins: 'старое' });
    expect(merged.wins).toBe('новое');
    expect(toPush).toEqual({ wins: 'новое' });
  });
  it('новый телефон / после выхода: пустые поля заполняет сервер, отправлять нечего', () => {
    const { merged, toPush } = mergeWeekNotes(E, { ...E, improve: 'ложиться до 23', gratitude: 'маме' });
    expect(merged).toEqual({ ...E, improve: 'ложиться до 23', gratitude: 'маме' });
    expect(toPush).toEqual({});
  });
  it('заметки, написанные до синхронизации, уезжают к мозгу', () => {
    const { toPush } = mergeWeekNotes({ ...E, notes: 'сдать отчёт' }, null);
    expect(toPush).toEqual({ notes: 'сдать отчёт' });
  });
});
