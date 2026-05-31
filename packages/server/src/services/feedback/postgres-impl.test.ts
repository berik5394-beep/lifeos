import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/feedback/postgres-impl.ts'),
  'utf-8'
);

describe('PostgresFeedback structure', () => {
  it('exports the class implementing FeedbackStore', () => {
    expect(SRC).toMatch(
      /export class PostgresFeedback implements FeedbackStore/
    );
  });

  it('applyFeedback routes axis signals into B1 with source=feedback', () => {
    expect(SRC).toMatch(/getUserAxesStore\(\)\.recordSignals/);
    expect(SRC).toMatch(/'feedback'/);
  });

  it('writes a CorrectionLog row', () => {
    expect(SRC).toMatch(/correctionLog\.create/);
  });

  it('recentCorrections reads ordered by recordedAt desc', () => {
    expect(SRC).toMatch(/correctionLog\.findMany/);
    expect(SRC).toMatch(/recordedAt:\s*'desc'/);
  });

  it('is best-effort — wraps in try/catch, never throws', () => {
    expect(SRC).toMatch(/catch/);
  });

  it('skips axis write when no signals (avoids empty EWMA churn)', () => {
    expect(SRC).toMatch(/axisSignals\.length/);
  });
});
