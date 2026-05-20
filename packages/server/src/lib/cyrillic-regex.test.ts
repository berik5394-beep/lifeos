import { describe, it, expect } from 'vitest';
import { cyrillicWord, containsAny } from './cyrillic-regex.js';

describe('cyrillicWord — корень с cyrillic-safe границей', () => {
  it('срабатывает на изолированное слово', () => {
    expect(cyrillicWord('хочу').test('я хочу спать')).toBe(true);
  });

  it('срабатывает в начале строки', () => {
    expect(cyrillicWord('хочу').test('хочу новый телефон')).toBe(true);
  });

  it('НЕ матчится как подстрока внутри другого слова', () => {
    // «хочу» не в «прихочуть» (выдуманное) — нужна не-буква до.
    expect(cyrillicWord('хочу').test('прихочуть')).toBe(false);
  });

  it('окружение пунктуацией работает', () => {
    expect(cyrillicWord('хочу').test('что я, хочу!')).toBe(true);
  });
});

describe('containsAny — переменный список фраз/regex', () => {
  it('строка-фраза = substring (без \\b — phrase-специфичность)', () => {
    expect(containsAny('мне очень тяжело', ['очень тяжело'])).toBe(true);
    expect(containsAny('я просто устал', ['очень тяжело'])).toBe(false);
  });

  it('regex-фраза', () => {
    expect(containsAny('хочу умереть', [/хочу\s+умереть/i])).toBe(true);
  });

  it('пустой текст / пустой массив → false', () => {
    expect(containsAny('', ['x'])).toBe(false);
    expect(containsAny('abc', [])).toBe(false);
  });
});
