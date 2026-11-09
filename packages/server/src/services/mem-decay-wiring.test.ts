import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');

describe('read-side decay — Part 1 entity-enrichment', () => {
  it('без флага: entityDecayScore ре-ранг', () => {
    expect(enr).not.toMatch(/isV2DecayEnabled/);
    expect(enr).toMatch(/entityDecayScore\(/);
    expect(enr).toMatch(/take:\s*25/);
  });
  it('из 25 кандидатов в блок идут топ-5 по decay', () => { expect(enr).toMatch(/\.slice\(0,\s*5\)/); });
});

describe('read-side decay — Part 2 recall FTS', () => {
  const svc = readFileSync(join(process.cwd(), 'src/services/memory-service.ts'), 'utf8');
  it('impTerm с затуханием + MEM_HALFLIFE_DAYS (без флага)', () => {
    expect(svc).not.toMatch(/isV2DecayEnabled/);
    expect(svc).toMatch(/MEM_HALFLIFE_DAYS/);
    expect(svc).toMatch(/power\(2,/);
  });
  it('importance-литерал внутри impTerm', () => { expect(svc).toMatch(/m\.importance::float \/ 10\.0/); });
});
