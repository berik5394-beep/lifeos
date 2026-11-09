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
  it('детектор без флага', () => {
    expect(ENGINE).not.toContain('isV2PersonTypesEnabled');
  });
  it('set_person_type зарегистрирован', () => {
    expect(TOOLS).toContain('setPersonTypeTool');
  });
  it('врезка personTypes без флага', () => {
    expect(ENRICH).not.toContain('isV2PersonTypesEnabled');
    expect(ENRICH).toContain('formatPersonTypesSection');
  });
  it('флага больше нет (всегда включено)', () => {
    expect(FLAGS).not.toContain('isV2PersonTypesEnabled');
  });
});
