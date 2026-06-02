import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);

describe('jarvis-orchestrator — M2 единый писатель за флагом (chat-факты :182)', () => {
  it('импортирует writeMemory и isV2WriteEnabled', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*writeMemory[^}]*\}\s*from\s*'\.\/episodic-memory\.js'/,
    );
    expect(SRC).toMatch(
      /import\s*\{[^}]*isV2WriteEnabled[^}]*\}\s*from\s*'\.\.\/lib\/feature-flags\.js'/,
    );
  });

  it('импорт captureMemory СОХРАНЁН (off-путь его зовёт; удаление — follow-up)', () => {
    expect(SRC).toMatch(
      /import\s*\{\s*captureMemory\s*\}\s*from\s*'\.\/memory-service\.js'/,
    );
  });

  it('цикл extracted.memories: ветка isV2WriteEnabled → writeMemory, иначе captureMemory', () => {
    const loopIdx = SRC.indexOf('for (const m of extracted.memories)');
    expect(loopIdx).toBeGreaterThan(-1);
    const body = SRC.slice(loopIdx, loopIdx + 900);
    expect(body).toContain('isV2WriteEnabled(userId)');
    expect(body).toContain('writeMemory(userId');
    expect(body).toContain('captureMemory(userId');
    expect(body).toContain('tags: m.tags');
    expect(body).toMatch(/source:\s*['"]chat['"]/);
  });
});

describe('jarvis-orchestrator — M2 preference-write за флагом (:666)', () => {
  it('purchase_explained: ветка isV2WriteEnabled → writeMemory, иначе captureMemory, оба fire-and-forget', () => {
    // Якорь — уникальный `if (!purchaseFlag)` (preference-блок). НЕ indexOf
    // по 'purchase_explained' (он впервые встречается выше, в вычислении
    // purchaseFlag через tags.has).
    const start = SRC.indexOf('if (!purchaseFlag)');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 700);
    expect(body).toContain('isV2WriteEnabled(userId)');
    expect(body).toMatch(/void writeMemory\(userId/);
    expect(body).toMatch(/void captureMemory\(userId/);
    expect(body).toContain("type: 'preference'");
    expect(body).toContain("tags: ['purchase_explained']");
  });
});
