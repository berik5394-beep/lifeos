import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const impl = readFileSync(join(process.cwd(), 'src/services/entity-graph/postgres-impl.ts'), 'utf8');
const iface = readFileSync(join(process.cwd(), 'src/services/entity-graph/types.ts'), 'utf8');

describe('F2-links — graph primitives', () => {
  it('interface объявляет activeLinksForEntity + invalidateLink', () => {
    expect(iface).toMatch(/activeLinksForEntity\(/);
    expect(iface).toMatch(/invalidateLink\(/);
  });
  it('impl invalidateLink — userId-фильтр + invalidAt active guard (cross-user safe)', () => {
    expect(impl).toMatch(/async invalidateLink\(/);
    expect(impl).toMatch(/updateMany\(\{[\s\S]*?userId[\s\S]*?invalidAt:\s*null/);
  });
  it('impl activeLinksForEntity — fromId OR toId, invalidAt null', () => {
    expect(impl).toMatch(/async activeLinksForEntity\(/);
    expect(impl).toMatch(/OR:\s*\[\{\s*fromId:[\s\S]*?toId:/);
  });
});
