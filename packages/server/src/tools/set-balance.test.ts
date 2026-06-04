import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { setBalanceTool } from './set-balance.js';

const SRC = readFileSync(join(__dirname, 'set-balance.ts'), 'utf8');

describe('set_balance — money-safety', () => {
  it('needsConfirm + sideEffects write', () => {
    expect(setBalanceTool.name).toBe('set_balance');
    expect(setBalanceTool.needsConfirm).toBe(true);
    expect(setBalanceTool.sideEffects).toBe('write');
  });
  it('flag-gated in handler', () => {
    expect(SRC).toMatch(/isV2RunwayBalanceEnabled\(ctx\.userId\)/);
  });
  it('writes only CashSnapshot (no Income/Expense ledger)', () => {
    expect(SRC).toMatch(/cashSnapshot\.create/);
    expect(SRC).not.toMatch(/prisma\.(income|expense)\.create/);
  });
});

describe('set_balance — registry', () => {
  it('registered in tools/index.ts', () => {
    const idx = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(idx).toMatch(/setBalanceTool/);
  });
});
