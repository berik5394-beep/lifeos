import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/ai/jarvis-prompt.ts'), 'utf-8');

describe('jarvis-prompt — анти-фабрикация записи', () => {
  it('правило «не заявляй о записи без вызова инструмента» в CORE', () => {
    expect(SRC).toMatch(/НИКОГДА не утверждай, что записал/);
  });
});
