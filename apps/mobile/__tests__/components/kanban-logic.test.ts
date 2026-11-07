import { cardDue, categoryLabel, columnIndexAt, columnOf } from '@/components/kanban/kanban-logic';

const NOW = new Date(2026, 10, 7, 10, 0); // 7 ноября 2026, локальное время

describe('columnOf — галочка главнее колонки', () => {
  it('выполненная (в списке/голосом) → «Готово»', () => {
    expect(columnOf({ kanbanStatus: 'in_progress', completed: true })).toBe('done');
  });
  it('сняли галочку у задачи из «Готово» → «К выполнению»', () => {
    expect(columnOf({ kanbanStatus: 'done', completed: false })).toBe('todo');
  });
  it('без колонки или с неизвестной → «К выполнению»; обычная — своя', () => {
    expect(columnOf({ completed: false })).toBe('todo');
    expect(columnOf({ kanbanStatus: 'weird', completed: false })).toBe('todo');
    expect(columnOf({ kanbanStatus: 'backlog', completed: false })).toBe('backlog');
  });
});

describe('categoryLabel', () => {
  it('по-русски с иконкой, а не «personal»', () => {
    expect(categoryLabel('personal')).toBe('👤 Личное');
    expect(categoryLabel('work')).toBe('💼 Работа');
  });
  it('неизвестная категория — как есть', () => {
    expect(categoryLabel('xyz')).toBe('xyz');
  });
});

describe('cardDue', () => {
  it('сегодня со временем, завтра, дата в этом году', () => {
    expect(cardDue({ date: '2026-11-07', time: '14:00', completed: false }, NOW)).toEqual({ label: 'Сегодня 14:00', overdue: false });
    expect(cardDue({ date: '2026-11-08', time: null, completed: false }, NOW).label).toBe('Завтра');
    expect(cardDue({ date: '2026-11-20', time: null, completed: false }, NOW).label).toBe('20 ноя');
    expect(cardDue({ date: '2027-01-02', time: null, completed: false }, NOW).label).toBe('2 янв 2027');
  });
  it('прошлое и не выполнено → «Просрочено»', () => {
    expect(cardDue({ date: '2026-11-05', time: null, completed: false }, NOW)).toEqual({ label: 'Просрочено · 5 ноя', overdue: true });
    expect(cardDue({ date: '2026-11-06T00:00:00.000Z', time: null, completed: false }, NOW).label).toBe('Просрочено · Вчера');
  });
  it('выполненная в прошлом — без «просрочено»', () => {
    expect(cardDue({ date: '2026-11-05', time: null, completed: true }, NOW)).toEqual({ label: '5 ноя', overdue: false });
  });
});

describe('columnIndexAt', () => {
  it('ближайшая колонка по прокрутке, в пределах доски', () => {
    expect(columnIndexAt(0, 378)).toBe(0);
    expect(columnIndexAt(378, 378)).toBe(1);
    expect(columnIndexAt(370, 378)).toBe(1);
    expect(columnIndexAt(5000, 378)).toBe(3);
    expect(columnIndexAt(-20, 378)).toBe(0);
  });
});
