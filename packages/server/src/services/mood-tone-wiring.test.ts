import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('mood-tone — Part 1 enrichment directive', () => {
  const enr = readFileSync(join(process.cwd(), 'src/services/v2-enrichment.ts'), 'utf8');
  it('флаг-гейт + директива при direction down', () => {
    expect(enr).toMatch(/isV2MoodToneEnabled\(/);
    expect(enr).toMatch(/moodToneDirective/);
    expect(enr).toMatch(/будь мягче/);
    expect(enr).toMatch(/перекрывает выбранный стиль/);
  });
});
