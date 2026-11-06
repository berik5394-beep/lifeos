import { buildUpdate, draftFromTask, normalizeTime, quickDays } from '@/components/tasks/task-edit-logic';

const TASK = { id: 't1', title: 'Отчёт', category: 'work', priority: 'high', date: '2026-11-06T00:00:00.000Z', time: '14:00', notes: 'к пятнице' };

describe('карточка правки задачи', () => {
  it('черновик из задачи: дата по дню, пустые поля — пустые строки', () => {
    expect(draftFromTask(TASK)).toEqual({ title: 'Отчёт', category: 'work', priority: 'high', date: '2026-11-06', time: '14:00', notes: 'к пятнице' });
    expect(draftFromTask({ ...TASK, time: null, notes: null })).toMatchObject({ time: '', notes: '' });
  });

  it('пустое время и заметки — очистить (null), а не «не менять»', () => {
    const r = buildUpdate({ ...draftFromTask(TASK), time: '', notes: '  ' });
    expect(r).toEqual({ ok: true, data: expect.objectContaining({ time: null, notes: null }) });
  });

  it('проверка: пустое название, неверная дата и время — понятная ошибка', () => {
    expect(buildUpdate({ ...draftFromTask(TASK), title: ' ' })).toEqual({ ok: false, error: expect.stringMatching(/что нужно сделать/) });
    expect(buildUpdate({ ...draftFromTask(TASK), date: '2026-02-30' })).toEqual({ ok: false, error: expect.stringMatching(/ГГГГ-ММ-ДД/) });
    expect(buildUpdate({ ...draftFromTask(TASK), time: '25:00' })).toEqual({ ok: false, error: expect.stringMatching(/ЧЧ:ММ/) });
  });

  it('«9:30» и «9.30» → «09:30»', () => {
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime('9.30')).toBe('09:30');
    expect(buildUpdate({ ...draftFromTask(TASK), time: '9:30' })).toEqual({ ok: true, data: expect.objectContaining({ time: '09:30' }) });
  });

  it('быстрые дни — от локальной даты, через границу месяца', () => {
    expect(quickDays(new Date(2026, 10, 30, 23, 30))).toEqual([
      { label: 'Сегодня', date: '2026-11-30' },
      { label: 'Завтра', date: '2026-12-01' },
      { label: 'Послезавтра', date: '2026-12-02' },
    ]);
  });
});
