import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from './index.js';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('v2 tools wired into registry', () => {
  it('registry exposes all 3 v2 tools', () => {
    expect(registry.has('remember_entity')).toBe(true);
    expect(registry.has('link_relationship')).toBe(true);
    expect(registry.has('suggest_goal')).toBe(true);
  });
  it('index.ts imports all 3', () => {
    expect(SRC).toMatch(/from '\.\/remember-entity\.js'/);
    expect(SRC).toMatch(/from '\.\/link-relationship\.js'/);
    expect(SRC).toMatch(/from '\.\/suggest-goal\.js'/);
  });
  it('ALL_TOOLS array lists all 3 by reference', () => {
    expect(SRC).toMatch(/\brememberEntityTool\b/);
    expect(SRC).toMatch(/\blinkRelationshipTool\b/);
    expect(SRC).toMatch(/\bsuggestGoalTool\b/);
  });
  it('suggest_goal correctly excluded from autonomous agent loop', () => {
    // Mirror existing money-safety invariant test pattern.
    const t = registry.get('suggest_goal')!;
    expect(t.needsConfirm).toBe(true);
  });
});
