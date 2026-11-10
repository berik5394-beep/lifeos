import { describe, it, expect } from 'vitest';
import { fuzzyNameRank, fuzzyRank, fuzzyWords, trigramSimilarity, wordSimilarity } from './fuzzy.js';

/** Поиск «по кусочкам букв» (2026-11-10): голос коверкает имена и названия. */
describe('fuzzy — похожесть по кусочкам букв', () => {
  it('совпадает с pg_trgm на простых случаях', () => {
    expect(trigramSimilarity('мама', 'Мама')).toBe(1);
    expect(trigramSimilarity('Серику', 'Серик')).toBeCloseTo(0.63, 1);
    expect(wordSimilarity('инвистор', 'встреча с инвестором')).toBeGreaterThan(0.5);
  });
  it('значимые слова: основы, без служебных и коротких', () => {
    expect(fuzzyWords('что я знаю про Сирика?')).toEqual(['сирик']);
    expect(fuzzyWords('напомни про инвистора и бюджет')).toEqual(['инвистор', 'бюджет']);
  });
  it('имена: опечатка голоса и падеж находят человека; чужое имя — нет', () => {
    const people = ['Серик Ахметов', 'Айгерим', 'Тимур', 'Мама'];
    const top = (q: string) => fuzzyNameRank(q, people, (p) => p)[0]?.item;
    expect(top('Сирик')).toBe('Серик Ахметов');
    expect(top('Серику')).toBe('Серик Ахметов');
    expect(top('Айгирим')).toBe('Айгерим');
    expect(top('Ерлан')).toBeUndefined();
    expect(top('Азамат')).toBeUndefined();
  });
  it('задачи: «отчот» находит «Подготовить отчёт», не «Позвонить маме»', () => {
    const tasks = ['Подготовить отчёт для банка', 'Позвонить маме', 'Купить продукты'];
    const r = fuzzyRank('подготовить отчот', tasks, (t) => t);
    expect(r.map((x) => x.item)).toEqual(['Подготовить отчёт для банка']);
    expect(fuzzyRank('пароль от вайфая', tasks, (t) => t)).toEqual([]);
  });
});
