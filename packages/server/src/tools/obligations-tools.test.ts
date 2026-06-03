import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('obligations tools wiring', () => {
  const idx = readFileSync(join(process.cwd(), 'src/tools/index.ts'), 'utf-8');

  it('4 инструмента зарегистрированы в ALL_TOOLS', () => {
    for (const t of [
      'createObligationTool',
      'listObligationsTool',
      'settleObligationTool',
      'cancelObligationTool',
    ]) {
      expect(idx).toContain(t);
    }
  });

  it('write-хендлеры флаг-гейтятся isV2ObligationsEnabled', () => {
    for (const f of ['create-obligation', 'settle-obligation', 'cancel-obligation']) {
      const src = readFileSync(join(process.cwd(), `src/tools/${f}.ts`), 'utf-8');
      expect(src).toContain('isV2ObligationsEnabled');
    }
  });

  it('settle money НЕ пишет деньги напрямую — только proposeFinance', () => {
    const settle = readFileSync(join(process.cwd(), 'src/tools/settle-obligation.ts'), 'utf-8');
    expect(settle).toContain('proposeFinance');
    expect(settle).not.toMatch(/prisma\.(income|expense)\.create/);
  });
});
