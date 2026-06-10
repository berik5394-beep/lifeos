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

describe('F2-links — end_relationship tool', () => {
  const tool = readFileSync(join(process.cwd(), 'src/tools/end-relationship.ts'), 'utf8');
  const idx = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf8');
  it('handler флаг-гейт isV2UnlinkEnabled', () => { expect(tool).toMatch(/isV2UnlinkEnabled\(ctx\.userId\)/); });
  it('single-match-или-скип (>1 и ===0 → не invalidate)', () => {
    expect(tool).toMatch(/links\.length > 1/);
    expect(tool).toMatch(/links\.length === 0/);
    expect(tool).toMatch(/invalidateLink\(/);
  });
  it('зарегистрирован в ALL_TOOLS', () => {
    expect(idx).toMatch(/endRelationshipTool/);
    expect(idx).toMatch(/from '\.\/end-relationship\.js'/);
  });
});
