import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('runRegistryTool — хук [A] M1 capture (chokepoint)', () => {
  it('импортирует captureActivity и summarizeToolAction', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*captureActivity[^}]*\}/);
    expect(SRC).toMatch(/import\s*\{[^}]*summarizeToolAction[^}]*\}/);
  });

  it('parsed вынесен в let parsedInput (видим после audit)', () => {
    expect(SRC).toMatch(/let parsedInput/);
    expect(SRC).toMatch(/parsedInput = tool\.schema\.parse\(/);
  });

  it('captureActivity вызывается после успешного исполнения через summarizeToolAction', () => {
    expect(SRC).toMatch(
      /captureActivity\(\s*ctx\.userId,\s*summarizeToolAction\(/,
    );
    expect(SRC).toMatch(
      /summarizeToolAction\(\s*name,\s*parsedInput,\s*result,\s*tool\.sideEffects/,
    );
  });

  it('захват НЕ await-ится (fire-and-forget — captureActivity сам void recordEvent)', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
