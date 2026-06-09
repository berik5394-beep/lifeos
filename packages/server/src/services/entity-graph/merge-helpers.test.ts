import { describe, it, expect } from 'vitest';
import { shouldMergeByEmbedding, capAliases, MERGE_MAX_COSINE_DIST } from './merge-helpers.js';
import { mergeAttributes } from './merge-helpers.js';

describe('shouldMergeByEmbedding', () => {
  it('dist ниже порога → true', () => { expect(shouldMergeByEmbedding(0.05, 0.12)).toBe(true); });
  it('dist равно порогу → true', () => { expect(shouldMergeByEmbedding(0.12, 0.12)).toBe(true); });
  it('dist выше порога → false', () => { expect(shouldMergeByEmbedding(0.13, 0.12)).toBe(false); });
  it('NaN/Infinity → false', () => {
    expect(shouldMergeByEmbedding(NaN, 0.12)).toBe(false);
    expect(shouldMergeByEmbedding(Infinity, 0.12)).toBe(false);
  });
  it('дефолтный порог из MERGE_MAX_COSINE_DIST', () => {
    expect(shouldMergeByEmbedding(MERGE_MAX_COSINE_DIST)).toBe(true);
    expect(shouldMergeByEmbedding(MERGE_MAX_COSINE_DIST + 0.001)).toBe(false);
  });
});

describe('capAliases', () => {
  it('дедуп case-insensitive, сохраняет первую форму', () => {
    expect(capAliases(['Серик', 'серик', 'Сериком'])).toEqual(['Серик', 'Сериком']);
  });
  it('тримит, дропает пустые', () => {
    expect(capAliases(['  Роза  ', '', '   '])).toEqual(['Роза']);
  });
  it('кап по количеству (max=2)', () => {
    expect(capAliases(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
  it('кап по длине (maxLen=3)', () => {
    expect(capAliases(['абвгд'], 20, 3)).toEqual(['абв']);
  });
});

describe('mergeAttributes (T5 graph guard)', () => {
  it('deliberate=true → incoming-wins', () => {
    expect(mergeAttributes({ relation: 'брат' }, { relation: 'знакомый' }, true)).toEqual({ relation: 'знакомый' });
  });
  it('фоновое: непустое существующее НЕ затирается', () => {
    expect(mergeAttributes({ relation: 'брат' }, { relation: 'знакомый' }, false)).toEqual({ relation: 'брат' });
  });
  it('фоновое: пустой/отсутствующий ключ заполняется', () => {
    expect(mergeAttributes({ relation: '' }, { relation: 'брат' }, false)).toEqual({ relation: 'брат' });
    expect(mergeAttributes({}, { role: 'дизайнер' }, false)).toEqual({ role: 'дизайнер' });
  });
  it('фоновое: новые ключи добавляются, старые сохраняются', () => {
    expect(mergeAttributes({ relation: 'брат' }, { city: 'Астана' }, false)).toEqual({ relation: 'брат', city: 'Астана' });
  });
  it('пустой incoming → existing неизменно', () => {
    expect(mergeAttributes({ relation: 'брат' }, {}, false)).toEqual({ relation: 'брат' });
  });
});
