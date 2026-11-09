import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAPTURE = readFileSync(join(process.cwd(), 'src/services/v2-capture.ts'), 'utf8');
const UPSERT = readFileSync(
  join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'),
  'utf8',
);

describe('entity-coreference wiring (гард)', () => {
  it('v2-capture пробрасывает aliases в upsertEntity', () => {
    expect(CAPTURE).toContain('input.aliases');
  });
  it('upsertEntity всегда зовёт resolveForMerge (флаг удалён)', () => {
    expect(UPSERT).toContain('this.resolveForMerge(');
    expect(UPSERT).not.toContain('isV2EntityResolveEnabled');
    expect(UPSERT).not.toContain('resolveOn');
  });
});
