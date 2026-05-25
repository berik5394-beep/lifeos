import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 7 P1 — DND quiet hours, schema-инвариант (без БД, как
 * phase5/phase6: парсим исходник). Гарантирует: nullable поля
 * на месте, миграция аддитивна (AGENTS.md §3, DEPLOY FOOTGUN —
 * без DROP).
 */

const root = process.cwd();
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf-8');

function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`model ${name} не найден`);
  return m[0];
}

describe('Phase 7 P1 — User.quietHoursStart/End (DND)', () => {
  const b = modelBlock('User');
  it('quietHoursStart String? (nullable)', () => {
    expect(b).toMatch(/quietHoursStart\s+String\?/);
  });
  it('quietHoursEnd String? (nullable)', () => {
    expect(b).toMatch(/quietHoursEnd\s+String\?/);
  });
  it('миграция p7_dnd_quiet_hours — аддитивна, без DROP', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) => d.includes('p7_dnd_quiet_hours'));
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quietHoursStart"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quietHoursEnd"/,
    );
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});
