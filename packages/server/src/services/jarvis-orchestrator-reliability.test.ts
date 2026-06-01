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

describe('jarvis-orchestrator — C larger text window (AUDIT/spec 2026-06-01)', () => {
  it('uses MAX_USER_TEXT SSOT constant (16000), not a 4000 hardcode', () => {
    expect(SRC).toMatch(/const MAX_USER_TEXT = 16000/);
    expect(SRC).toMatch(/slice\(0, MAX_USER_TEXT\)/);
    // старого хардкода 4000 в persist-срезах не осталось
    expect(SRC).not.toMatch(/\.slice\(0, 4000\)/);
  });
});
