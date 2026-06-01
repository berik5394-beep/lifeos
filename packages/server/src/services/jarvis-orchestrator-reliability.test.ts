import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'jarvis-orchestrator.ts'), 'utf8');

// 1.4 (AUDIT-2026-06): capture не должен блокировать ответ. Поведенчески
// (latency) не тестируем — проверяем структурно, что вызов fire-and-forget
// с .catch (иначе unhandled rejection), а не await.
describe('jarvis-orchestrator — 1.4 capture non-blocking', () => {
  it('captureInBackground вызывается fire-and-forget (void + .catch)', () => {
    expect(SRC).toMatch(/void captureInBackground\(/);
    expect(SRC).toMatch(/captureInBackground\([^)]*\)[\s\S]{0,80}\.catch\(/);
  });
  it('captureInBackground больше НЕ await-ится на горячем пути', () => {
    expect(SRC).not.toMatch(/await captureInBackground\(/);
  });
});
