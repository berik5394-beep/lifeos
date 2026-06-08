import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T2 структурный гард: каждый из 5 экстракторов ищет СВОЙ паттерн по
// identity-ключу в payload (за флагом isV2PatternDedupEnabled), а не первый
// попавшийся по kind. off=байт-идентично (ветка `: {}` ничего не добавляет).
const SRC = readFileSync(join(__dirname, 'procedural-memory.ts'), 'utf8');

/** Тело экстрактора: от его сигнатуры до следующей `export async function`. */
function extractorBlock(name: string): string {
  const start = SRC.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`extractor ${name} not found`);
  const rest = SRC.slice(start + `export async function ${name}`.length);
  const nextIdx = rest.indexOf('export async function ');
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

describe('T2 dedup wiring — flag import', () => {
  it('импортирует isV2PatternDedupEnabled из feature-flags', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*isV2PatternDedupEnabled[^}]*\}\s*from\s*'\.\.\/lib\/feature-flags\.js'/,
    );
  });
});

describe('T2 dedup wiring — payload identity-filter за флагом', () => {
  const cases: Array<{ fn: string; keys: string[] }> = [
    { fn: 'extractFrequencyPatterns', keys: ['entityId'] },
    { fn: 'extractTimeOfDayPatterns', keys: ['habitId'] },
    { fn: 'extractRecurringTopicPatterns', keys: ['entityId', 'clusterIndex'] },
    { fn: 'extractCommitmentPatterns', keys: ['sourceMsgId'] },
    { fn: 'extractStreakBreakPatterns', keys: ['habitId', 'weekNumber'] },
  ];

  for (const { fn, keys } of cases) {
    it(`${fn}: findFirst за флагом фильтрует по ${keys.join('+')}`, () => {
      const block = extractorBlock(fn);
      // флаг вызывается с userId
      expect(block).toContain('isV2PatternDedupEnabled(userId)');
      // каждый identity-ключ присутствует как path-фильтр
      for (const k of keys) {
        expect(block).toContain(`path: ['${k}']`);
      }
      // off-safe: флаг используется в тернаре с пустой else-веткой `: {}`
      // (окно 400 — двух-ключевая AND-ветка длиннее одно-ключевой).
      expect(block).toMatch(/isV2PatternDedupEnabled\(userId\)[\s\S]{0,400}: \{\}\)/);
    });
  }

  it('двух-ключевые экстракторы используют AND из двух path-фильтров', () => {
    for (const fn of ['extractRecurringTopicPatterns', 'extractStreakBreakPatterns']) {
      const block = extractorBlock(fn);
      // AND-массив появляется в ветке флага (два path-фильтра на одно поле payload)
      expect(block).toMatch(/isV2PatternDedupEnabled\(userId\)[\s\S]{0,80}AND:\s*\[/);
    }
  });
});
