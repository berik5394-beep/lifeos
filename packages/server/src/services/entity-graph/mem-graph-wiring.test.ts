import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const impl = readFileSync(join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'), 'utf8');

describe('T5 graph — upsertEntity attributes guard за флагом', () => {
  it('upsertEntity принимает opts.deliberate', () => {
    expect(impl).toMatch(/opts\??\s*:\s*\{\s*deliberate\?\s*:\s*boolean/);
  });
  it('обе точки merge имеют флаг-ветку mergeAttributes', () => {
    const on = impl.match(/isV2MemGraphEnabled\(userId\)\s*\n?\s*\?\s*mergeAttributes\(/g) || [];
    expect(on.length).toBe(2);
  });
});

describe('T5 graph — инструменты передают deliberate:true', () => {
  const tool = (f: string) => readFileSync(join(process.cwd(), `src/tools/${f}`), 'utf8');
  it('remember-entity', () => { expect(tool('remember-entity.ts')).toMatch(/deliberate:\s*true/); });
  it('set-birthday', () => { expect(tool('set-birthday.ts')).toMatch(/deliberate:\s*true/); });
  it('link-relationship (оба upsert)', () => {
    expect((tool('link-relationship.ts').match(/deliberate:\s*true/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('set-person-type', () => { expect(tool('set-person-type.ts')).toMatch(/deliberate:\s*true/); });
});

describe('T5 graph — FTS rank-порог в дедупе writeMemory', () => {
  const epi = readFileSync(join(process.cwd(), 'src/services/episodic-memory.ts'), 'utf8');
  it('константа MEM_DEDUP_MIN_RANK', () => { expect(epi).toMatch(/MEM_DEDUP_MIN_RANK\s*=\s*0\.08/); });
  it('rank в SELECT дедупа', () => { expect(epi).toMatch(/ts_rank\([\s\S]*?\)\s+AS rank/); });
  it('rankOk гейт за флагом', () => {
    expect(epi).toMatch(/isV2MemGraphEnabled\(userId\)/);
    expect(epi).toMatch(/rankOk/);
  });
});
