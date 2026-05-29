import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/entity-graph/index.ts'),
  'utf-8',
);

describe('entity-graph/index.ts structural', () => {
  it('exports getEntityGraph singleton accessor', () => {
    expect(SRC).toMatch(/export function getEntityGraph/);
  });

  it('exports _resetEntityGraphForTests (test helper)', () => {
    expect(SRC).toMatch(/export function _resetEntityGraphForTests/);
  });

  it('re-exports EntityGraphStore type', () => {
    expect(SRC).toContain('EntityGraphStore');
  });

  it('re-exports PostgresEntityGraph', () => {
    expect(SRC).toContain('PostgresEntityGraph');
  });

  it('singleton returns same instance on subsequent calls', async () => {
    // Import after SRC read to avoid stale module cache affecting SRC.
    const { getEntityGraph, _resetEntityGraphForTests } = await import('./index.js');
    _resetEntityGraphForTests();
    const a = getEntityGraph();
    const b = getEntityGraph();
    expect(a).toBe(b);
  });

  it('_resetEntityGraphForTests creates fresh instance', async () => {
    const { getEntityGraph, _resetEntityGraphForTests } = await import('./index.js');
    _resetEntityGraphForTests();
    const a = getEntityGraph();
    _resetEntityGraphForTests();
    const b = getEntityGraph();
    expect(a).not.toBe(b);
  });
});
