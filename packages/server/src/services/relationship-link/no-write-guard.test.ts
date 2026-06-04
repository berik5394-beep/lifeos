import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('relationship-link read-only guard', () => {
  const dir = join(process.cwd(), 'src/services/relationship-link');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
  it('ни одного prisma write в services/relationship-link', () => {
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf-8');
      expect(s, `${f} must not write`).not.toMatch(
        /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/,
      );
      expect(s, `${f} must not use raw SQL / $transaction`).not.toMatch(
        /prisma\.\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe|transaction)\b/,
      );
    }
  });
});
