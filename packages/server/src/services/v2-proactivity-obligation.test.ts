import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('obligation_due detector wiring', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/services/v2-proactivity-engine.ts'),
    'utf-8',
  );
  it('источник в union + шаблон + детектор + регистрация в detectCandidates', () => {
    expect(src).toContain("'obligation_due'");
    expect(src).toContain('obligation_due:');
    expect(src).toContain('async function detectObligationDue');
    expect(src).toMatch(/detectCandidates[\s\S]*detectObligationDue\(userId\)/);
  });
});
