import { describe, it, expect } from 'vitest';
import { goalPickPrompt, parseGoalPick } from './task-goal-link.js';
import { formatScreenConflict } from './schedule-conflict/index.js';

describe('выбор цели для задачи — разбор ответа модели', () => {
  it('один номер в диапазоне → индекс', () => {
    expect(parseGoalPick('2', 3)).toBe(1);
    expect(parseGoalPick(' 1\n', 1)).toBe(0);
  });
  it('0 / нет числа / вне диапазона / колеблется → не привязываем', () => {
    expect(parseGoalPick('0', 3)).toBeNull();
    expect(parseGoalPick('не уверен', 3)).toBeNull();
    expect(parseGoalPick('4', 3)).toBeNull();
    expect(parseGoalPick('1 или 2', 3)).toBeNull();
  });
  it('промпт: задача + нумерованные цели', () => {
    expect(goalPickPrompt('Прочитать главу', [{ goalText: '24 книги' }, { goalText: 'Марафон' }])).toBe(
      'Задача: «Прочитать главу»\n\nЦели:\n1. 24 книги\n2. Марафон',
    );
  });
});

describe('облачко наложения с экрана', () => {
  it('без «перенести?» — с экрана не ответишь', () => {
    const t = formatScreenConflict([
      { title: 'Планёрка', kind: 'event', startMin: 600, endMin: 660 },
      { title: 'Позвонить', kind: 'task', startMin: 610, endMin: 611 },
    ]);
    expect(t).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00, задачей «Позвонить» в 10:10.');
    expect(t).not.toContain('перенести');
    expect(formatScreenConflict([])).toBe('');
  });
});
