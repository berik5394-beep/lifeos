import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'claude-agent.ts'), 'utf8');

describe('claude-agent — confirm-bridge (structural)', () => {
  it('runAgent принимает onConfirmTool', () => {
    expect(SRC).toMatch(/onConfirmTool\?\s*:/);
  });
  it('показывает confirm-схемы агенту (за onConfirmTool)', () => {
    expect(SRC).toMatch(/confirmToolSchemasForUser/);
    expect(SRC).toMatch(/confirmToolNamesForUser/);
  });
  it('использует partitionToolUses', () => {
    expect(SRC).toMatch(/partitionToolUses\(/);
  });
  it('confirm-proposal вызывает onConfirmTool (не runRegistryTool)', () => {
    expect(SRC).toMatch(/return await onConfirmTool\(/);
  });
});
