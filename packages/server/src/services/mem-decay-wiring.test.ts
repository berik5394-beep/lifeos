import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');

describe('read-side decay — Part 1 entity-enrichment', () => {
  it('флаг-ветка isV2DecayEnabled + entityDecayScore ре-ранг', () => {
    expect(enr).toMatch(/isV2DecayEnabled\(/);
    expect(enr).toMatch(/entityDecayScore\(/);
    expect(enr).toMatch(/take:\s*25/);
  });
  it('off-ветка сохраняет take: 5', () => { expect(enr).toMatch(/take:\s*5/); });
});
