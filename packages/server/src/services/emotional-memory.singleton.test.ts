import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/emotional-memory.singleton.ts'),
  'utf-8',
);

describe('emotional-memory.singleton.ts structural', () => {
  it('exports getEmotionalMemory accessor', () => {
    expect(SRC).toMatch(/export function getEmotionalMemory/);
  });

  it('exports _resetEmotionalMemoryForTests', () => {
    expect(SRC).toMatch(/export function _resetEmotionalMemoryForTests/);
  });

  it('singleton returns same instance', async () => {
    const { getEmotionalMemory, _resetEmotionalMemoryForTests } = await import(
      './emotional-memory.singleton.js'
    );
    _resetEmotionalMemoryForTests();
    expect(getEmotionalMemory()).toBe(getEmotionalMemory());
  });

  it('_resetEmotionalMemoryForTests yields fresh instance', async () => {
    const { getEmotionalMemory, _resetEmotionalMemoryForTests } = await import(
      './emotional-memory.singleton.js'
    );
    _resetEmotionalMemoryForTests();
    const a = getEmotionalMemory();
    _resetEmotionalMemoryForTests();
    const b = getEmotionalMemory();
    expect(a).not.toBe(b);
  });
});
