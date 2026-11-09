import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENG = readFileSync(join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');
const REF = readFileSync(join(process.cwd(), 'src/services/reflector-v2/index.ts'), 'utf-8');

describe('adaptive threshold wiring', () => {
  it('proactivity gate3 uses adaptiveThreshold (без флага)', () => {
    expect(ENG).not.toMatch(/isV2EngagementEnabled/);
    expect(ENG).toMatch(/adaptiveThreshold/);
    expect(ENG).toMatch(/gate3_Significance\(c, /);
  });
  it('reflector event check uses an adaptive threshold', () => {
    expect(REF).not.toMatch(/isV2EngagementEnabled/);
    expect(REF).toMatch(/adaptiveThreshold/);
    expect(REF).toMatch(/significanceScore/);
  });
});
