import { describe, it, expect } from 'vitest';
import { shouldMergeByEmbedding, capAliases, MERGE_MAX_COSINE_DIST } from './merge-helpers.js';
import { mergeAttributes, attrHistoryFacts, canonicalAttrKey } from './merge-helpers.js';

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
    const now = new Date('2026-11-07T10:00:00Z');
    expect(mergeAttributes({ relation: 'брат' }, { relation: 'знакомый' }, true, [], now)).toEqual({
      relation: 'знакомый',
      _history: [{ key: 'relation', value: 'брат', until: now.toISOString() }],
    });
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

describe('mergeAttributes — «изменилось» из разговора', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  it('«мама переехала в Астану»: changed → новое заменяет старое, старое в истории', () => {
    const r = mergeAttributes({ город: 'Алматы', relation: 'мама' }, { город: 'Астана' }, false, ['город'], now);
    expect(r.город).toBe('Астана');
    expect(r.relation).toBe('мама');
    expect(r._history).toEqual([{ key: 'город', value: 'Алматы', until: now.toISOString() }]);
  });
  it('без «изменилось» фон по-прежнему не затирает', () => {
    expect(mergeAttributes({ город: 'Алматы' }, { город: 'Астана' }, false, [], now)).toEqual({ город: 'Алматы' });
  });
  it('синонимы ключей: city ↔ город — пишем в существующий ключ, без дубля', () => {
    const r = mergeAttributes({ город: 'Алматы' }, { city: 'Астана' }, false, ['city'], now);
    expect(r).toMatchObject({ город: 'Астана' });
    expect(r.city).toBeUndefined();
  });
  it('то же значение (регистр/ё) — ничего не меняется, истории нет', () => {
    expect(mergeAttributes({ город: 'Алматы' }, { город: 'алматы' }, false, ['город'], now)).toEqual({ город: 'Алматы' });
  });
  it('пустое incoming не стирает значение', () => {
    expect(mergeAttributes({ город: 'Алматы' }, { город: '' }, false, ['город'], now)).toEqual({ город: 'Алматы' });
  });
  it('история копится и ограничена', () => {
    let a: Record<string, unknown> = { город: 'Г0' };
    for (let i = 1; i <= 25; i++) a = mergeAttributes(a, { город: `Г${i}` }, true, [], now);
    expect((a._history as unknown[]).length).toBe(20);
    expect(a.город).toBe('Г25');
  });
  it('canonicalAttrKey', () => {
    expect(canonicalAttrKey('City')).toBe('город');
    expect(canonicalAttrKey('Место жительства')).toBe('город');
    expect(canonicalAttrKey('хобби')).toBe('хобби');
  });
  it('attrHistoryFacts: последнее прежнее значение каждого ключа', () => {
    const a = mergeAttributes(mergeAttributes({ город: 'Алматы' }, { город: 'Шымкент' }, true, [], now), { город: 'Астана' }, true, [], now);
    expect(attrHistoryFacts(a)).toEqual(['раньше город: Шымкент']);
    expect(attrHistoryFacts({})).toEqual([]);
  });
});
