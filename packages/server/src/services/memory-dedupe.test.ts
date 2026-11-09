import { describe, it, expect } from 'vitest';
import { pickDedupTarget, normalizeMemoryText, type DedupCandidate } from './episodic-memory.js';

const c = (p: Partial<DedupCandidate>): DedupCandidate => ({
  id: 'm', importance: 5, tags: [], details: null, rank: 0, fwd: false, rev: false, exact: false, oldLex: 2, ...p,
});

describe('pickDedupTarget — с какой записью слить', () => {
  it('точный повтор — всегда, даже одно слово с низким рангом («Серик» ×2)', () => {
    expect(pickDedupTarget([c({ id: 'a', exact: true, fwd: true, rank: 0.06, oldLex: 1 })], 1)?.id).toBe('a');
  });
  it('новое ⊂ старое — только сильный ранг (как раньше)', () => {
    expect(pickDedupTarget([c({ id: 'a', fwd: true, rank: 0.26 })], 3)?.id).toBe('a');
    expect(pickDedupTarget([c({ id: 'a', fwd: true, rank: 0.06, oldLex: 5 })], 1)).toBeNull();
  });
  it('уточнение: старое ⊂ новое, ≥2 слова и покрывает ≥ половины нового', () => {
    // «Любит кофе» (2) ← «Очень любит кофе по утрам» (4)
    expect(pickDedupTarget([c({ id: 'a', rev: true, oldLex: 2 })], 4)?.id).toBe('a');
    // «Мама — Айгуль» (2) ← «Маму зовут Айгуль» (3)
    expect(pickDedupTarget([c({ id: 'a', rev: true, oldLex: 2 })], 3)?.id).toBe('a');
  });
  it('одно слово не поглощает разные факты («Серик» ⊂ «Серик должен 20 000 до пятницы»)', () => {
    expect(pickDedupTarget([c({ id: 'a', rev: true, oldLex: 1 })], 4)).toBeNull();
  });
  it('короткое старое в длинном новом (покрытие < половины) — новая запись', () => {
    expect(pickDedupTarget([c({ id: 'a', rev: true, oldLex: 2 })], 6)).toBeNull();
  });
  it('приоритет: точный → сильный прямой → самое полное уточнение', () => {
    const cands = [c({ id: 'rev', rev: true, oldLex: 3 }), c({ id: 'fwd', fwd: true, rank: 0.3 }), c({ id: 'ex', exact: true })];
    expect(pickDedupTarget(cands, 3)?.id).toBe('ex');
    expect(pickDedupTarget(cands.slice(0, 2), 3)?.id).toBe('fwd');
    expect(pickDedupTarget([c({ id: 'r2', rev: true, oldLex: 2 }), c({ id: 'r3', rev: true, oldLex: 3 })], 4)?.id).toBe('r3');
  });
});

describe('normalizeMemoryText', () => {
  it('регистр, пробелы и точка в конце не важны', () => {
    expect(normalizeMemoryText('  Серик  — брат. ')).toBe('серик — брат');
    expect(normalizeMemoryText('Не ест мясо!')).toBe('не ест мясо');
  });
});
