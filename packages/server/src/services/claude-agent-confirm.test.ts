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

describe('claude-agent — итоговый вызов после лимита раундов', () => {
  it('tools те же, вызывать запрещено (tool_choice none) — без tools API отклоняет историю с tool_use', () => {
    expect(SRC).toMatch(/tool_choice: \{ type: 'none' as const \}/);
  });
});
