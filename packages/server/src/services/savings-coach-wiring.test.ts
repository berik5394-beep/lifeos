import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('savings-coach проводка в оркестратор', () => {
  it('импортирует хук', () => {
    expect(SRC).toContain('import { maybeSavingsCoachLine }');
  });
  it('зовётся в ОБЕИХ точках исполнения add_expense', () => {
    const calls = SRC.match(/maybeSavingsCoachLine\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
  it('только для add_expense', () => {
    expect(SRC).toContain("=== 'add_expense'");
  });
});
