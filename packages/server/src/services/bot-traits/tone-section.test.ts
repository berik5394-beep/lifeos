import { describe, it, expect } from 'vitest';
import { formatToneSection } from './tone-section.js';
import type { BotTraits } from './types.js';

const base: BotTraits = {
  warmth: 0.5, directness: 0.5, humor: 0.3, playfulness: 0.4,
  relationshipDepth: 0.2, lastComputedAt: null,
};

describe('formatToneSection', () => {
  it('null traits → empty string', () => {
    expect(formatToneSection(null, 47)).toBe('');
  });
  it('renders all 4 traits with values + labels', () => {
    const out = formatToneSection(base, 47);
    expect(out).toContain('warmth: 0.50');
    expect(out).toContain('directness: 0.50');
    expect(out).toContain('humor: 0.30');
    expect(out).toContain('playfulness: 0.40');
  });
  it('shows relationship depth + message count', () => {
    const out = formatToneSection(base, 47);
    expect(out).toContain('0.20');
    expect(out).toContain('47');
  });
  it('high warmth includes warm guidance', () => {
    const out = formatToneSection({ ...base, warmth: 0.85 }, 100);
    expect(out).toContain('warmth: 0.85');
    expect(out.toLowerCase()).toMatch(/тёпл|забот/);
  });
  it('high directness includes direct guidance', () => {
    const out = formatToneSection({ ...base, directness: 0.85 }, 100);
    expect(out.toLowerCase()).toMatch(/прям|честн/);
  });
  it('low humor suppresses jokes', () => {
    const out = formatToneSection({ ...base, humor: 0.15 }, 100);
    expect(out.toLowerCase()).toMatch(/серьёзн|без шут|мало/);
  });
});
