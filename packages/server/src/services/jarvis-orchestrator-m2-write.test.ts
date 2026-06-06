import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

/**
 * M3 Unit A (2026-06-06): legacy captureMemory удалён. Оркестратор пишет
 * безусловно через ЕДИНЫЙ writeMemory (FEATURE_V2_WRITE=all в проде).
 */
describe('jarvis-orchestrator — M3 Unit A: единый писатель writeMemory (chat-факты)', () => {
  it('импортирует writeMemory', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*writeMemory[^}]*\}\s*from\s*'\.\/episodic-memory\.js'/,
    );
  });

  it('legacy captureMemory НЕ импортируется и НЕ вызывается (удалён)', () => {
    expect(SRC).not.toMatch(/import\s*\{[^}]*captureMemory/);
    expect(SRC).not.toMatch(/(await|void)\s+captureMemory\(/);
  });

  it('цикл extracted.memories: безусловный writeMemory (без флаг-ветки)', () => {
    const loopIdx = SRC.indexOf('for (const m of extracted.memories)');
    expect(loopIdx).toBeGreaterThan(-1);
    const body = SRC.slice(loopIdx, loopIdx + 700);
    expect(body).toContain('await writeMemory(userId');
    expect(body).toContain('tags: m.tags');
    expect(body).toMatch(/source:\s*['"]chat['"]/);
    expect(body).not.toContain('isV2WriteEnabled');
  });
});

describe('jarvis-orchestrator — M3 Unit A: preference-write безусловный', () => {
  it('purchase_explained: void writeMemory, без captureMemory/флага', () => {
    const start = SRC.indexOf('if (!purchaseFlag)');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 600);
    expect(body).toMatch(/void writeMemory\(userId/);
    expect(body).toContain("type: 'preference'");
    expect(body).toContain("tags: ['purchase_explained']");
    expect(body).not.toContain('isV2WriteEnabled');
  });
});
