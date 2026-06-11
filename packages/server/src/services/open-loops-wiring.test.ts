import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');

describe('open-loops — Part 1 enrichment', () => {
  it('флаг-ветка + gatherOpenLoops + поле openLoops + push', () => {
    expect(enr).toMatch(/isV2OpenLoopsEnabled\(/);
    expect(enr).toMatch(/gatherOpenLoops\(/);
    expect(enr).toMatch(/openLoops/);
    expect(enr).toMatch(/data\.openLoops/);
  });
});

describe('open-loops — Part 2 proactivity', () => {
  const eng = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf8');
  it('source+template+score+детектор с ранним флаг-гейтом', () => {
    expect(eng).toMatch(/'open_loop_pileup'/);
    expect(eng).toMatch(/open_loop_pileup:\s*\{/);
    expect(eng).toMatch(/detectOpenLoopPileup/);
    expect(eng).toMatch(/isV2OpenLoopsEnabled\(/);
    expect(eng).toMatch(/shouldNudgeOpenLoops\(/);
  });
});
