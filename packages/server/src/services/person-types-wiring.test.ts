import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const TOOLS = readFileSync(join(__dirname, '../tools/index.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');
const FLAGS = readFileSync(join(__dirname, '../lib/feature-flags.ts'), 'utf8');

describe('person-types wiring (гард)', () => {
  it('neglected_key_person в union/score/TEMPLATES/detectCandidates', () => {
    expect(ENGINE).toContain("| 'neglected_key_person'");
    expect(ENGINE).toContain("case 'neglected_key_person':");
    expect(ENGINE).toContain('neglected_key_person: {');
    expect(ENGINE).toContain('detectNeglectedKeyPerson(userId),');
  });
  it('детектор флаг-гейтнут (off=identical)', () => {
    expect(ENGINE).toContain('if (!isV2PersonTypesEnabled(userId)) return [];');
  });
  it('set_person_type зарегистрирован', () => {
    expect(TOOLS).toContain('setPersonTypeTool');
  });
  it('врезка personTypes за флагом', () => {
    expect(ENRICH).toContain('isV2PersonTypesEnabled(userId)');
    expect(ENRICH).toContain('formatPersonTypesSection');
  });
  it('флаг существует', () => {
    expect(FLAGS).toContain('export function isV2PersonTypesEnabled');
  });
});
