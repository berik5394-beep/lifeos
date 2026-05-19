import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 C1 — schema-инвариант (без БД, как phase5-schema:
 * парсим исходник). Гарантирует: crisis-флаг есть, миграция
 * аддитивна (ISSUE-X / DEPLOY FOOTGUN — без DROP), индекс под
 * purge/analytics-exclusion объявлен.
 */

const root = process.cwd();
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf-8');

function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`model ${name} не найден`);
  return m[0];
}

describe('Phase 6 C1 — ChatMessage.crisis (Safety isolation)', () => {
  const b = modelBlock('ChatMessage');
  it('crisis Boolean @default(false) присутствует', () => {
    expect(b).toMatch(/crisis\s+Boolean\s+@default\(false\)/);
  });
  it('индекс (crisis, createdAt) для purge/analytics-exclusion', () => {
    expect(b).toMatch(/@@index\(\[crisis, createdAt\]\)/);
  });
  it('миграция p6_chatmessage_crisis — аддитивна, без DROP', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) =>
      d.includes('p6_chatmessage_crisis'),
    );
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "crisis"/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "ChatMessage_crisis_createdAt_idx"/,
    );
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});
