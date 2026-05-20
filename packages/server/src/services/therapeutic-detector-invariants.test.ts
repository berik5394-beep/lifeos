import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 C4 — структурные инварианты сервиса детекторов
 * (refactor-proof). Два класса:
 *  - C1(d): ChatMessage-чтение ВСЕГДА с crisis=false (новый
 *    читатель — обязан соблюдать инвариант, как profile-synth);
 *  - ≤1 therapeutic-инсайт/день: pickTop ограничивает массив,
 *    persistCandidates вызывается с массивом из 1 элемента
 *    максимум; cadence-гард использует startsWith 'therapeutic_'.
 */

const SVC = readFileSync(
  join(process.cwd(), 'src/services/therapeutic-detector-service.ts'),
  'utf-8',
);

describe('therapeutic-detector-service — C1(d) crisis-isolation', () => {
  it('каждое chatMessage.{count,findMany} несёт crisis:false', () => {
    const calls = [...SVC.matchAll(/chatMessage\.(count|findMany)\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const m of calls) {
      const slice = SVC.slice(m.index, m.index + 240);
      expect(
        /crisis:\s*false/.test(slice),
        `chatMessage.${m[1]} без crisis:false`,
      ).toBe(true);
    }
  });
});

describe('therapeutic-detector-service — ≤1/день top-severity gate', () => {
  it('pickTop возвращает 0 или 1 кандидат (не массив)', () => {
    // pickTop — приватная, проверим что persistCandidates вызывается
    // с массивом [top] (один элемент), а не cands напрямую.
    expect(SVC).toMatch(/persistCandidates\(userId,\s*\[top\],/);
  });
  it('cadence-гард: уже есть therapeutic за день → ran:false', () => {
    expect(SVC).toMatch(
      /kind:\s*\{\s*startsWith:\s*'therapeutic_'\s*\}/,
    );
    expect(SVC).toMatch(/if\s+\(already\s*>\s*0\)\s+return\s+\{\s*ran:\s*false/);
  });
});
