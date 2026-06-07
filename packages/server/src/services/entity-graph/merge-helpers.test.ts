import { describe, it, expect } from 'vitest';
import { shouldMergeByEmbedding, capAliases, MERGE_MAX_COSINE_DIST } from './merge-helpers.js';

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
