import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ENGINE = readFileSync(join(__dirname, '..', 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, '..', 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '..', '..', 'lib', 'feature-flags.ts'), 'utf8');
const TOOLS_INDEX = readFileSync(join(__dirname, '..', '..', 'tools', 'index.ts'), 'utf8');
const TOOL = readFileSync(join(__dirname, '..', '..', 'tools', 'set-birthday.ts'), 'utf8');
const GATHER = readFileSync(join(__dirname, 'birthday.ts'), 'utf8');

describe('birthday wiring (structural)', () => {
  it('флаг isV2BirthdayEnabled существует', () => {
    expect(FLAGS).toMatch(/export function isV2BirthdayEnabled/);
    expect(FLAGS).toMatch(/FEATURE_V2_BIRTHDAY/);
  });
  it('NudgeSource + TEMPLATES + scoreSignificance + detectCandidates содержат birthday_upcoming', () => {
    expect(ENGINE).toMatch(/'birthday_upcoming'/);
    expect(ENGINE).toMatch(/birthday_upcoming:\s*{/);
    expect(ENGINE).toMatch(/case 'birthday_upcoming':/);
    expect(ENGINE).toMatch(/detectBirthday\(userId\)/);
  });
  it('detectBirthday имеет ранний флаг-гейт (off=identical)', () => {
    const fn = ENGINE.slice(ENGINE.indexOf('async function detectBirthday'));
    expect(fn).toMatch(/if\s*\(!isV2BirthdayEnabled\(userId\)\)\s*return\s*\[\]/);
  });
  it('enrichment-врезка за флагом + поле birthdays', () => {
    expect(ENRICH).toMatch(/birthdays:\s*string\s*\|\s*null/);
    expect(ENRICH).toMatch(/isV2BirthdayEnabled\(userId\)/);
    expect(ENRICH).toMatch(/buildBirthdaySection\(userId\)/);
    expect(ENRICH).toMatch(/if\s*\(data\.birthdays\)/);
  });
  it('set_birthday зарегистрирован в ALL_TOOLS', () => {
    expect(TOOLS_INDEX).toMatch(/setBirthdayTool/);
    expect(TOOL).toMatch(/name:\s*'set_birthday'/);
    expect(TOOL).toMatch(/needsConfirm:\s*false/);
  });
  it('money-safety: services/birthday/birthday.ts не делает write в prisma', () => {
    expect(GATHER).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert|updateMany|deleteMany|createMany)/);
  });
});
