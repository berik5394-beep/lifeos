import { describe, it, expect } from 'vitest';
import {
  shouldSynthesize,
  parseProfile,
  type SynthGate,
} from './profile-core.js';

const DAY = 86_400_000;
const NOW = new Date('2026-05-19T12:00:00Z');

function gate(p: Partial<SynthGate> = {}): SynthGate {
  return {
    lastSynthesizedAt: null,
    now: NOW,
    interactions7d: 20,
    newDataSince: true,
    ...p,
  };
}

describe('shouldSynthesize — cadence/active-gate (cost-control)', () => {
  it('неактивен (<10/нед) → false (не жжём деньги)', () => {
    expect(shouldSynthesize(gate({ interactions7d: 9 }))).toBe(false);
  });
  it('активен + ни разу не синтезирован → true', () => {
    expect(shouldSynthesize(gate({ lastSynthesizedAt: null }))).toBe(true);
  });
  it('< недели с прошлого синтеза → false (каденс раз/неделю)', () => {
    expect(
      shouldSynthesize(
        gate({ lastSynthesizedAt: new Date(NOW.getTime() - 3 * DAY) }),
      ),
    ).toBe(false);
  });
  it('> недели, но нет новых данных → false', () => {
    expect(
      shouldSynthesize(
        gate({
          lastSynthesizedAt: new Date(NOW.getTime() - 8 * DAY),
          newDataSince: false,
        }),
      ),
    ).toBe(false);
  });
  it('> недели + новые данные + активен → true', () => {
    expect(
      shouldSynthesize(
        gate({ lastSynthesizedAt: new Date(NOW.getTime() - 8 * DAY) }),
      ),
    ).toBe(true);
  });
  it('неактивность бьёт ВСЁ (даже never+newData)', () => {
    expect(
      shouldSynthesize(
        gate({ interactions7d: 0, lastSynthesizedAt: null }),
      ),
    ).toBe(false);
  });
});

describe('parseProfile — защитный разбор (мусор НЕ персистим)', () => {
  it('валидный JSON → нормализованный профиль', () => {
    const r = parseProfile(
      JSON.stringify({
        values: ['family', 'career', 7, ''],
        triggers: ['criticism'],
        patterns: [],
        styleNotes: '  direct, no fluff ',
        relationships: { 'мама': 'сложно', x: 5 },
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.values).toEqual(['family', 'career']); // не-строки/пустые убраны
    expect(r!.styleNotes).toBe('direct, no fluff');
    expect(r!.relationships).toEqual({ 'мама': 'сложно' });
  });

  it('невалидный JSON → null (не пишем мусор)', () => {
    expect(parseProfile('не json вовсе')).toBeNull();
  });

  it('JSON-массив (не объект) → null', () => {
    expect(parseProfile('[1,2,3]')).toBeNull();
  });

  it('обёртка ```json … ``` → парсится из тела', () => {
    const r = parseProfile('```json\n{"values":["a"]}\n```');
    expect(r?.values).toEqual(['a']);
  });

  it('частичный объект → отсутствующее = пусто (честно, не отказ)', () => {
    const r = parseProfile('{"values":["x"]}');
    expect(r).toEqual({
      values: ['x'],
      triggers: [],
      patterns: [],
      styleNotes: null,
      relationships: {},
    });
  });

  it('кап на размеры (anti prompt-bloat)', () => {
    const big = Array.from({ length: 50 }, (_, i) => `v${i}`);
    const r = parseProfile(JSON.stringify({ values: big }));
    expect(r!.values.length).toBeLessThanOrEqual(20);
  });
});
