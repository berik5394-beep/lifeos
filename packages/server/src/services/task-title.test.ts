import { describe, it, expect } from 'vitest';
import { sanitizeTaskTitle, matchOpenTask } from './task-title.js';

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
