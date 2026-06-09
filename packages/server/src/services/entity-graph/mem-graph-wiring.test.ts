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
