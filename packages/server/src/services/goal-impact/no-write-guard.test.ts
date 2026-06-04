import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('goal-impact read-only guard (money-safety)', () => {
  it('ни одного prisma write в services/goal-impact', () => {
    const dir = join(process.cwd(), 'src/services/goal-impact');
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.includes('.test.'),
    );
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(
        src,
        `${f} must not write to the DB`,
      ).not.toMatch(
        /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/,
      );
    }
  });
});
