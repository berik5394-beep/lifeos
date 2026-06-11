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

describe('read-side decay — Part 2 recall FTS', () => {
  const svc = readFileSync(join(process.cwd(), 'src/services/memory-service.ts'), 'utf8');
  it('флаг-гейт impTerm + MEM_HALFLIFE_DAYS', () => {
    expect(svc).toMatch(/isV2DecayEnabled\(/);
    expect(svc).toMatch(/MEM_HALFLIFE_DAYS/);
    expect(svc).toMatch(/power\(2,/);
  });
  it('off сохраняет прежний importance-литерал', () => { expect(svc).toMatch(/m\.importance::float \/ 10\.0/); });
});
