import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = readFileSync(join(__dirname, 'v2-proactivity-engine.ts'), 'utf8');
const ENRICH = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');

describe('person-meeting wiring (гард)', () => {
  it('person_meeting в union/score/TEMPLATES/detectCandidates', () => {
    expect(ENGINE).toContain("| 'person_meeting'");
    expect(ENGINE).toContain("case 'person_meeting':");
    expect(ENGINE).toContain('person_meeting: {');
    expect(ENGINE).toContain('detectPersonMeeting(userId),');
  });
  it('детектор ставит entityId (per-meeting cooldown) + флаг-гейт', () => {
    expect(ENGINE).toContain('entityId: soon.entityId');
    expect(ENGINE).toContain('if (!isV2PersonTypesEnabled(userId)) return [];');
  });
  it('врезка personMeetings за флагом', () => {
    expect(ENRICH).toContain('buildPersonMeetingBriefs');
    expect(ENRICH).toContain('formatPersonMeetingsSection');
  });
});
