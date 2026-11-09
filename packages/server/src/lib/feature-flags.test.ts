import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Все не-тестовые .ts в src (рекурсивно). */
function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return srcFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('флаги FEATURE_V2_* удалены (2026-11-09, на проде были all)', () => {
  it('в коде нет ни хелперов isV2…Enabled, ни чтения process.env.FEATURE_V2_*', () => {
    const offenders = srcFiles(join(process.cwd(), 'src')).filter((p) => {
      const s = readFileSync(p, 'utf8');
      return /\bisV2[A-Za-z]+Enabled\b/.test(s) || /process\.env(?:\.|\[['"])FEATURE_V2_/.test(s);
    });
    expect(offenders).toEqual([]);
  });
});

describe('featureFlagSnapshot — лог флагов без id', () => {
  it('значения как есть, списки — числом, без самих id', async () => {
    const { featureFlagSnapshot } = await import('./feature-flags.js');
    const s = featureFlagSnapshot({ FEATURE_V2_B: 'all', FEATURE_V2_A: 'user-1,user-2', FEATURE_V2_C: '', OTHER: 'x' } as NodeJS.ProcessEnv);
    expect(s).toBe('V2_A=список(2) V2_B=all V2_C=(пусто)');
    expect(s).not.toContain('user-1');
  });
});
