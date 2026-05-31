import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgsResponse } from './arg-resolver.js';

describe('parseArgsResponse (pure)', () => {
  it('parses an array of arg objects sized to plan', () => {
    const out = parseArgsResponse('[{"amount":3000},{}]', 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ amount: 3000 });
    expect(out[1]).toEqual({});
  });
  it('strips markdown fences', () => {
    const out = parseArgsResponse('```json\n[{"x":1}]\n```', 1);
    expect(out[0]).toEqual({ x: 1 });
  });
  it('pads/truncates to planLen', () => {
    expect(parseArgsResponse('[{"a":1}]', 3)).toHaveLength(3);
    expect(parseArgsResponse('[{},{},{},{}]', 2)).toHaveLength(2);
  });
  it('garbage → array of empty objects sized to plan', () => {
    const out = parseArgsResponse('not json', 2);
    expect(out).toEqual([{}, {}]);
    expect(parseArgsResponse('', 1)).toEqual([{}]);
  });
  it('non-object array elements → empty object', () => {
    expect(parseArgsResponse('[1,"x"]', 2)).toEqual([{}, {}]);
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/hermes/arg-resolver.ts'), 'utf-8');

describe('resolveSkillArgs structure', () => {
  it('exports resolveSkillArgs using haiku + parseArgsResponse', () => {
    expect(SRC).toMatch(/export async function resolveSkillArgs/);
    expect(SRC).toMatch(/MODELS\.haiku/);
    expect(SRC).toMatch(/parseArgsResponse/);
  });
  it('best-effort fallback to argTemplate / {} on failure', () => {
    expect(SRC).toMatch(/argTemplate/);
    expect(SRC).toMatch(/catch/);
  });
});
