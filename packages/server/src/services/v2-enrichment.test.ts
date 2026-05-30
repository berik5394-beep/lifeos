import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildV2EnrichmentBlock,
  formatAxesSection,
  type V2EnrichmentData,
} from './v2-enrichment.js';

const SRC = readFileSync(join(__dirname, 'v2-enrichment.ts'), 'utf8');

const FULL: V2EnrichmentData = {
  identity: { botName: 'Жозефина', style: 'warm' },
  patterns: [
    { kind: 'frequency', summary: 'звонки маме ~раз в 4 дня' },
    { kind: 'time_of_day', summary: 'кофе 08:30 ±20м' },
    { kind: 'commitment', summary: 'обещал отчёт к пятнице' },
  ],
  moodShift: {
    shifted: true,
    direction: 'down',
    magnitude: -0.5,
    sinceDays: 2,
  },
  entities: [
    { name: 'мама', importance: 9, daysSinceLastSeen: 3 },
    { name: 'Серик', importance: 7, daysSinceLastSeen: 1 },
  ],
};

describe('buildV2EnrichmentBlock — pure', () => {
  it('starts with the v2-память header', () => {
    expect(buildV2EnrichmentBlock(FULL)).toMatch(/^\[v2-память\]/);
  });
  it('renders bot name + style on identity line', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/имя:\s*Жозефина.*стиль:\s*warm/);
  });
  it('joins patterns with «; »', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/звонки маме[^;]*;.*кофе[^;]*;.*обещал отчёт/s);
  });
  it('renders mood shift magnitude with direction emoji', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/📉.*-0\.5/);
  });
  it('renders entity line with importance + days ago', () => {
    const out = buildV2EnrichmentBlock(FULL);
    expect(out).toMatch(/мама \(важн 9, виделись 3д назад\)/);
  });
  it('omits patterns line when none', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, patterns: [] });
    expect(out).not.toMatch(/активные паттерны/);
  });
  it('omits mood line when no shift', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, moodShift: null });
    expect(out).not.toMatch(/настроение/);
  });
  it('omits entities line when none', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, entities: [] });
    expect(out).not.toMatch(/ключевые/);
  });
  it('falls back to JARVIS when no identity', () => {
    const out = buildV2EnrichmentBlock({ ...FULL, identity: null });
    expect(out).toMatch(/имя:\s*JARVIS/);
  });
  it('caps patterns at 3 and entities at 5', () => {
    const many: V2EnrichmentData = {
      ...FULL,
      patterns: Array.from({ length: 10 }, (_, i) => ({
        kind: 'frequency',
        summary: `p${i}`,
      })),
      entities: Array.from({ length: 10 }, (_, i) => ({
        name: `e${i}`,
        importance: i,
        daysSinceLastSeen: i,
      })),
    };
    const out = buildV2EnrichmentBlock(many);
    expect((out.match(/p\d/g) ?? []).length).toBe(3);
    expect((out.match(/\be\d\b/g) ?? []).length).toBe(5);
  });
});

describe('structural — fetcher', () => {
  it('exports fetchV2EnrichmentData', () => {
    expect(SRC).toMatch(/export async function fetchV2EnrichmentData\(/);
  });
  it('queries identity + procedural patterns + emotional shift + entities', () => {
    expect(SRC).toMatch(/getBotIdentityService\(\)/);
    expect(SRC).toMatch(/getActivePatterns\(/);
    expect(SRC).toMatch(/minConfidence:\s*0\.6/);
    expect(SRC).toMatch(/detectMoodShift\(/);
    expect(SRC).toMatch(/topEntities\(|staleEntities\(|orderBy:.*importance/);
  });
  it('returns null on top-level failure (best-effort)', () => {
    expect(SRC).toMatch(/return null/);
  });
});

describe('formatAxesSection (D1)', () => {
  const axesBase = {
    selfDiscipline: 0.5,
    emotionalOpenness: 0.5,
    conflictTolerance: 0.5,
    introspectionDepth: 0.5,
    signalCount: 0,
    lastSignalAt: null,
  };

  it('returns empty string when no axes available (null input)', () => {
    expect(formatAxesSection(null)).toBe('');
  });
  it('renders 4 axis lines with labels for moderate (default) values', () => {
    const out = formatAxesSection(axesBase);
    expect(out).toContain('self-discipline: 0.50');
    expect(out).toContain('emotional-openness: 0.50');
    expect(out).toContain('conflict-tolerance: 0.50');
    expect(out).toContain('introspection-depth: 0.50');
    // All four are "средняя" at 0.5
    expect((out.match(/средняя/g) ?? []).length).toBe(4);
  });
  it('includes guidance when SD low', () => {
    const out = formatAxesSection({ ...axesBase, selfDiscipline: 0.25 });
    expect(out).toContain('self-discipline: 0.25');
    expect(out).toContain('низкая');
    // Guidance about 1-step plans (substring; exact wording in
    // implementation, but must convey the rule)
    expect(out.toLowerCase()).toMatch(/один|1[-\s]?шаг|шаг/);
  });
  it('includes guidance when EO high', () => {
    const out = formatAxesSection({ ...axesBase, emotionalOpenness: 0.85 });
    expect(out).toContain('emotional-openness: 0.85');
    expect(out).toContain('очень высокая');
  });
});

describe('fetchV2EnrichmentAxesSection — axes integration (D1)', () => {
  // The function is async and reads from DB / singleton. We verify the
  // wiring structurally via readFileSync; runtime is covered by integration.
  it('exports fetchV2EnrichmentAxesSection helper', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toMatch(/export async function fetchV2EnrichmentAxesSection/);
  });
  it('reads axes via getUserAxesStore().getAxes', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('getUserAxesStore');
    expect(enrichSrc).toMatch(/\.getAxes\(/);
  });
  it('calls formatAxesSection to render output', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('formatAxesSection');
  });
  it('gated by isV2AxesEnabled', () => {
    const enrichSrc = readFileSync(
      join(process.cwd(), 'src/services/v2-enrichment.ts'),
      'utf-8',
    );
    expect(enrichSrc).toContain('isV2AxesEnabled');
  });
});
