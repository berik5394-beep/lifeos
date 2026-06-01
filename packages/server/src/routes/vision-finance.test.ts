import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const SRC = readFileSync(join(process.cwd(), 'src/routes/vision.ts'), 'utf8');

describe('vision — POST /vision/analyze-finance', () => {
  it('route registered with photo limit + ai limiter + auth', () => {
    expect(SRC).toMatch(/'\/vision\/analyze-finance'/);
    const i = SRC.indexOf("'/vision/analyze-finance'");
    const block = SRC.slice(i, i + 600);
    expect(block).toMatch(/bodyLimit: PHOTO_BODY_LIMIT/);
    expect(block).toMatch(/aiDailyLimiter/);
  });
  it('uses analyzeFinancePhoto + buildFinancePending', () => {
    expect(SRC).toMatch(/analyzeFinancePhoto/);
    expect(SRC).toMatch(/buildFinancePending/);
  });
});
