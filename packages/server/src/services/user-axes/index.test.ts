import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/index.ts'),
  'utf-8',
);

describe('user-axes/index.ts structural', () => {
  it('exports getUserAxesStore', () => {
    expect(SRC).toMatch(/export function getUserAxesStore/);
  });
  it('exports _resetUserAxesForTests (test helper)', () => {
    expect(SRC).toMatch(/export function _resetUserAxesForTests/);
  });
  it('re-exports UserAxesStore type', () => {
    expect(SRC).toContain('UserAxesStore');
  });
  it('re-exports PostgresUserAxes', () => {
    expect(SRC).toContain('PostgresUserAxes');
  });

  it('singleton returns same instance on subsequent calls', async () => {
    const { getUserAxesStore, _resetUserAxesForTests } = await import('./index.js');
    _resetUserAxesForTests();
    const a = getUserAxesStore();
    const b = getUserAxesStore();
    expect(a).toBe(b);
  });
  it('_resetUserAxesForTests creates fresh instance', async () => {
    const { getUserAxesStore, _resetUserAxesForTests } = await import('./index.js');
    _resetUserAxesForTests();
    const a = getUserAxesStore();
    _resetUserAxesForTests();
    const b = getUserAxesStore();
    expect(a).not.toBe(b);
  });
});
