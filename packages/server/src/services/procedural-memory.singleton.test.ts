import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/procedural-memory.singleton.ts'),
  'utf-8',
);

describe('procedural-memory.singleton.ts structural', () => {
  it('exports getProceduralMemory accessor', () => {
    expect(SRC).toMatch(/export function getProceduralMemory/);
  });

  it('exports _resetProceduralMemoryForTests test helper', () => {
    expect(SRC).toMatch(/export function _resetProceduralMemoryForTests/);
  });

  it('returns same instance on subsequent calls', async () => {
    const { getProceduralMemory, _resetProceduralMemoryForTests } = await import(
      './procedural-memory.singleton.js'
    );
    _resetProceduralMemoryForTests();
    const a = getProceduralMemory();
    const b = getProceduralMemory();
    expect(a).toBe(b);
  });

  it('_resetProceduralMemoryForTests yields fresh instance', async () => {
    const { getProceduralMemory, _resetProceduralMemoryForTests } = await import(
      './procedural-memory.singleton.js'
    );
    _resetProceduralMemoryForTests();
    const a = getProceduralMemory();
    _resetProceduralMemoryForTests();
    const b = getProceduralMemory();
    expect(a).not.toBe(b);
  });
});
