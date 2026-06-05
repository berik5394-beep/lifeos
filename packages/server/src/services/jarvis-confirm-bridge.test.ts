import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(join(__dirname, 'jarvis-orchestrator.ts'), 'utf8');

describe('jarvis-orchestrator — confirm-bridge wiring (structural)', () => {
  it('импортирует buildConfirmPrompt', () => {
    expect(SRC).toMatch(/buildConfirmPrompt/);
  });
  it('пробрасывает onConfirmTool в runAgent (стейдж + текст)', () => {
    expect(SRC).toMatch(/onConfirmTool:\s*async/);
    expect(SRC).toMatch(/setPendingAction\(userId,\s*tool,\s*args/);
  });
});
