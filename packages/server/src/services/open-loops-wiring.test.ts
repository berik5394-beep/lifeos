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
