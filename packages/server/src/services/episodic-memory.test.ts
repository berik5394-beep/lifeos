import { describe, it, expect } from 'vitest';
import { validateEventInput, clampMood } from './episodic-memory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('clampMood — emotional valence -1..+1', () => {
  it('returns undefined for undefined input', () => {
    expect(clampMood(undefined)).toBeUndefined();
  });

  it('clamps below -1 to -1', () => {
    expect(clampMood(-5)).toBe(-1);
    expect(clampMood(-1.0001)).toBe(-1);
  });

  it('clamps above +1 to +1', () => {
    expect(clampMood(5)).toBe(1);
    expect(clampMood(1.0001)).toBe(1);
  });

  it('passes through values in [-1, +1]', () => {
    expect(clampMood(0)).toBe(0);
    expect(clampMood(-0.5)).toBe(-0.5);
    expect(clampMood(0.7)).toBe(0.7);
    expect(clampMood(-1)).toBe(-1);
    expect(clampMood(1)).toBe(1);
  });
});

describe('validateEventInput', () => {
  it('passes valid input', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'звонил маме',
        validAt: new Date('2026-05-28'),
      }),
    ).not.toThrow();
  });

  it('throws if content empty', () => {
    expect(() => validateEventInput({ type: 'event', content: '' })).toThrow(/content/);
    expect(() => validateEventInput({ type: 'event', content: '   ' })).toThrow(/content/);
  });

  it('throws if type empty', () => {
    expect(() => validateEventInput({ type: '', content: 'x' })).toThrow(/type/);
  });

  it('throws if invalidAt before validAt', () => {
    expect(() =>
      validateEventInput({
        type: 'event',
        content: 'x',
        validAt: new Date('2026-06-01'),
        invalidAt: new Date('2026-05-01'),
      }),
    ).toThrow(/validAt.*invalidAt/);
  });

  it('throws if importance out of [1, 10]', () => {
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 0 }),
    ).toThrow(/importance/);
    expect(() =>
      validateEventInput({ type: 'event', content: 'x', importance: 11 }),
    ).toThrow(/importance/);
  });

  it('passes importance in range', () => {
    for (let i = 1; i <= 10; i++) {
      expect(() =>
        validateEventInput({ type: 'event', content: 'x', importance: i }),
      ).not.toThrow();
    }
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/episodic-memory.ts'),
  'utf-8',
);

describe('episodic-memory.ts structural — recordEvent wiring', () => {
  it('recordEvent exported as async function', () => {
    expect(SRC).toMatch(/export async function recordEvent\s*\(/);
  });

  it('recordEvent calls validateEventInput before prisma write', () => {
    // Find recordEvent body
    const start = SRC.indexOf('export async function recordEvent');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    // Order: validateEventInput appears before prisma.memory.create
    const validateIdx = body.indexOf('validateEventInput(');
    const createIdx = body.indexOf('prisma.memory.create');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(createIdx);
  });

  it('recordEvent applies clampMood', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('clampMood(');
  });

  it('recordEvent sets source = "v2-episodic"', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1500);
    expect(body).toMatch(/source:\s*['"]v2-episodic['"]/);
  });
});

describe('episodic-memory.ts structural — invalidateEvent wiring', () => {
  it('invalidateEvent exported as async function', () => {
    expect(SRC).toMatch(/export async function invalidateEvent\s*\(/);
  });

  it('invalidateEvent calls prisma.memory.update with invalidAt', () => {
    const start = SRC.indexOf('export async function invalidateEvent');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.update');
    expect(body).toContain('invalidAt');
  });

  it('invalidateEvent defaults invalidAt to new Date()', () => {
    const start = SRC.indexOf('export async function invalidateEvent');
    const body = SRC.slice(start, start + 800);
    // Parameter signature contains default
    expect(body).toMatch(/invalidAt\s*:\s*Date\s*=\s*new Date\(\)/);
  });
});
