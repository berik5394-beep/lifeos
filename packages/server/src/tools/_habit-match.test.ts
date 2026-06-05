import { describe, it, expect } from 'vitest';
import { normalizeHabit, matchHabit, buildNotFoundMessage } from './_habit-match.js';

const H = (id: string, name: string) => ({ id, name });

describe('normalizeHabit', () => {
  it('lowercase + убирает пунктуацию + схлоп пробелов', () => {
    expect(normalizeHabit('  Утренняя, Зарядка!  ')).toBe('утренняя зарядка');
  });
});

describe('matchHabit (морфология)', () => {
  const habits = [H('h1', 'Зарядка'), H('h2', 'Медитация'), H('h3', 'Чтение')];
  it('винительный падеж: «зарядку» → Зарядка', () => {
    expect(matchHabit('зарядку', habits)?.id).toBe('h1');
  });
  it('«медитацию» → Медитация', () => {
    expect(matchHabit('медитацию', habits)?.id).toBe('h2');
  });
  it('род. падеж: «чтения» → Чтение', () => {
    expect(matchHabit('чтения', habits)?.id).toBe('h3');
  });
  it('точное совпадение', () => {
    expect(matchHabit('Зарядка', habits)?.id).toBe('h1');
  });
  it('опечатка «зарядкаа» → fuzzy → Зарядка', () => {
    expect(matchHabit('зарядкаа', habits)?.id).toBe('h1');
  });
  it('семантически далёкое «бег» → null (честный отказ)', () => {
    expect(matchHabit('бег', habits)).toBeNull();
  });
  it('пустой/нет привычек → null', () => {
    expect(matchHabit('', habits)).toBeNull();
    expect(matchHabit('зарядка', [])).toBeNull();
  });
  it('неоднозначность (два равных кандидата) → null', () => {
    const ambi = [H('a', 'Бег утром'), H('b', 'Бег вечером')];
    expect(matchHabit('бег', ambi)).toBeNull();
  });
});

describe('buildNotFoundMessage', () => {
  it('есть привычки → список + вопрос', () => {
    const m = buildNotFoundMessage('зарядку', [H('h1', 'Чтение'), H('h2', 'Медитация')]);
    expect(m).toContain('Не нашёл');
    expect(m).toContain('Чтение');
    expect(m).toContain('Медитация');
  });
  it('нет привычек → предложение завести', () => {
    expect(buildNotFoundMessage('зарядку', [])).toContain('нет привычек');
  });
});
