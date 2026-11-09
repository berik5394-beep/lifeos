import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T2 структурный гард: каждый из 5 экстракторов ищет СВОЙ паттерн по
// identity-ключу в payload, а не первый попавшийся по kind (флага больше нет).
const SRC = readFileSync(join(__dirname, 'procedural-memory.ts'), 'utf8');

/** Тело экстрактора: от его сигнатуры до следующей `export async function`. */
function extractorBlock(name: string): string {
  const start = SRC.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`extractor ${name} not found`);
  const rest = SRC.slice(start + `export async function ${name}`.length);
  const nextIdx = rest.indexOf('export async function ');
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

describe('T2 dedup wiring — флаг удалён', () => {
  it('isV2PatternDedupEnabled больше не используется', () => {
    expect(SRC).not.toMatch(/isV2PatternDedupEnabled/);
  });
});

describe('T2 dedup wiring — payload identity-filter', () => {
  const cases: Array<{ fn: string; keys: string[] }> = [
    { fn: 'extractFrequencyPatterns', keys: ['entityId'] },
    { fn: 'extractTimeOfDayPatterns', keys: ['habitId'] },
    { fn: 'extractRecurringTopicPatterns', keys: ['entityId', 'clusterIndex'] },
    { fn: 'extractCommitmentPatterns', keys: ['sourceMsgId'] },
    { fn: 'extractStreakBreakPatterns', keys: ['habitId', 'weekNumber'] },
  ];

  for (const { fn, keys } of cases) {
    it(`${fn}: findFirst фильтрует по ${keys.join('+')}`, () => {
      const block = extractorBlock(fn);
      // каждый identity-ключ присутствует как path-фильтр
      for (const k of keys) {
        expect(block).toContain(`path: ['${k}']`);
      }
    });
  }

  it('двух-ключевые экстракторы используют AND из двух path-фильтров', () => {
    for (const fn of ['extractRecurringTopicPatterns', 'extractStreakBreakPatterns']) {
      const block = extractorBlock(fn);
      // AND-массив: два path-фильтра на одно поле payload
      expect(block).toMatch(/AND:\s*\[\s*\{ payload: \{ path:/);
    }
  });
});
