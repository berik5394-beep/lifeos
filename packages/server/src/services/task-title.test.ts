import { describe, it, expect } from 'vitest';
import { sanitizeTaskTitle, matchOpenTask, pickOpenTask } from './task-title.js';

describe('sanitizeTaskTitle', () => {
  it('strips trailing relative-date phrase «на сегодня»', () => {
    expect(sanitizeTaskTitle('написать годовой отчёт на сегодня')).toBe(
      'написать годовой отчёт',
    );
  });
  it('strips dangling trailing preposition «на»', () => {
    expect(sanitizeTaskTitle('написать годовой отчёт на')).toBe('написать годовой отчёт');
  });
  it('strips bare trailing date word «завтра»', () => {
    expect(sanitizeTaskTitle('позвонить маме завтра')).toBe('позвонить маме');
  });
  it('does NOT strip mid-sentence preposition («в зал»)', () => {
    expect(sanitizeTaskTitle('сходить в зал')).toBe('сходить в зал');
  });
  it('leaves clean title unchanged', () => {
    expect(sanitizeTaskTitle('купить молоко')).toBe('купить молоко');
  });
  it('does not empty the title (only «на» → returns trimmed original)', () => {
    expect(sanitizeTaskTitle('на')).toBe('на');
  });
  it('trims whitespace', () => {
    expect(sanitizeTaskTitle('  отчёт  ')).toBe('отчёт');
  });
});

describe('matchOpenTask', () => {
  const tasks = [
    { id: 't1', title: 'написать годовой отчёт', createdAt: new Date('2026-06-01') },
    { id: 't2', title: 'подготовить презентацию', createdAt: new Date('2026-06-02') },
  ];
  it('finds when query is longer than stored (query⊇stored)', () => {
    // юзер: «отметь написать годовой отчёт на сегодня», в БД чистое название
    expect(matchOpenTask('написать годовой отчёт на сегодня', tasks)?.id).toBe('t1');
  });
  it('finds when stored is longer than query (stored⊇query)', () => {
    expect(matchOpenTask('презентацию', tasks)?.id).toBe('t2');
  });
  it('case-insensitive', () => {
    expect(matchOpenTask('ПРЕЗЕНТАЦИЮ', tasks)?.id).toBe('t2');
  });
  it('returns most recent on multiple matches', () => {
    const dup = [
      { id: 'old', title: 'отчёт', createdAt: new Date('2026-06-01') },
      { id: 'new', title: 'отчёт', createdAt: new Date('2026-06-03') },
    ];
    expect(matchOpenTask('отчёт', dup)?.id).toBe('new');
  });
  it('no match → null', () => {
    expect(matchOpenTask('купить хлеб', tasks)).toBeNull();
  });
  it('empty query → null', () => {
    expect(matchOpenTask('', tasks)).toBeNull();
  });
});

describe('pickOpenTask — «закрой задачу X» без угадывания', () => {
  const t = (title: string, minsAgo: number) => ({ title, createdAt: new Date(Date.now() - minsAgo * 60_000) });
  it('одна подходящая — она', () => {
    expect(pickOpenTask('отчёт', [t('отчёт для банка', 5), t('купить хлеб', 1)])).toMatchObject({ kind: 'one', task: { title: 'отчёт для банка' } });
  });
  it('две подходящие — спросить «какую?» (свежие первыми)', () => {
    const r = pickOpenTask('отчёт', [t('отчёт для банка', 5), t('отчёт по дому', 1)]);
    expect(r.kind).toBe('many');
    expect(r.kind === 'many' && r.tasks.map((x) => x.title)).toEqual(['отчёт по дому', 'отчёт для банка']);
  });
  it('несколько, но одна совпадает названием целиком — она', () => {
    expect(pickOpenTask('отчёт', [t('отчёт', 5), t('отчёт по дому', 1)])).toMatchObject({ kind: 'one', task: { title: 'отчёт' } });
  });
  it('ничего — none', () => {
    expect(pickOpenTask('сайт', [t('отчёт', 1)])).toEqual({ kind: 'none' });
  });
});

describe('голова «на завтра: отчёт» (прод: задача «на : отчёт»)', () => {
  it.each([
    ['на : отчёт', 'отчёт'],
    ['на завтра: отчёт', 'отчёт'],
    ['— купить хлеб', 'купить хлеб'],
    ['завтра: позвонить маме', 'позвонить маме'],
  ])('«%s» → «%s»', (a, b) => expect(sanitizeTaskTitle(a)).toBe(b));
  it.each(['в 9:00 созвон', 'на дачу: забрать рассаду', 'отчёт: финальная версия'])('«%s» не трогаем', (a) =>
    expect(sanitizeTaskTitle(a)).toBe(a),
  );
});

describe('sanitizeTaskTitle — точка из голоса', () => {
  it('«купить хлеб .» после вырезания даты → «купить хлеб»', () => {
    expect(sanitizeTaskTitle('купить хлеб .')).toBe('купить хлеб');
    expect(sanitizeTaskTitle('Купить хлеб на завтра.')).toBe('Купить хлеб');
  });
});
