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

describe('Phase 6 C5 — User.therapeuticMode (opt-out)', () => {
  it('User.therapeuticMode Boolean default(true)', () => {
    expect(modelBlock('User')).toMatch(
      /therapeuticMode\s+Boolean\s+@default\(true\)/,
    );
  });
  it('миграция p6_user_therapeutic_mode — аддитивна, без DROP', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) =>
      d.includes('p6_user_therapeutic_mode'),
    );
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "therapeuticMode" BOOLEAN NOT NULL DEFAULT true/,
    );
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});

describe('Phase 6 C2 — UserProfile (derived view over Memory)', () => {
  const b = modelBlock('UserProfile');
  it('обязательные поля присутствуют', () => {
    expect(b).toMatch(/userId\s+String\s+@unique/);
    expect(b).toMatch(/values\s+Json\s+@default\("\[\]"\)/);
    expect(b).toMatch(/triggers\s+Json\s+@default\("\[\]"\)/);
    expect(b).toMatch(/patterns\s+Json\s+@default\("\[\]"\)/);
    expect(b).toMatch(/styleNotes\s+String\?/);
    expect(b).toMatch(/relationships\s+Json\s+@default\("\{\}"\)/);
    expect(b).toMatch(/lastSynthesizedAt\s+DateTime\?/);
    expect(b).toMatch(/synthesisVersion\s+Int\s+@default\(0\)/);
  });
  it('onDelete:Cascade (кэш уходит с юзером — это не источник)', () => {
    expect(b).toMatch(/onDelete:\s*Cascade/);
  });
  it('User.userProfile обратная связь объявлена', () => {
    expect(modelBlock('User')).toMatch(/userProfile\s+UserProfile\?/);
  });
  it('миграция p6_userprofile — CREATE TABLE IF NOT EXISTS, без DROP', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) =>
      d.includes('p6_userprofile'),
    );
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS "UserProfile"/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_userId_key"/,
    );
    expect(sql).toMatch(/ON DELETE CASCADE/);
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});
