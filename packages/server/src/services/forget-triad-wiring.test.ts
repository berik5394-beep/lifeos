import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const READER = readFileSync(join(__dirname, 'memory-service.ts'), 'utf8');
const WRITER = readFileSync(join(__dirname, 'episodic-memory.ts'), 'utf8');

describe('forget-triad wiring (гард)', () => {
  it('ридер флаг-гейтит message + invalidAt', () => {
    expect(READER).toContain('isV2ForgetEnabled');
    expect(READER).toContain("m.type <> 'message'");
    expect(READER).toContain('invalidAt');
  });
  it('писатель гейтит createdAt под флагом', () => {
    expect(WRITER).toContain('isV2ForgetEnabled');
    expect(WRITER).toMatch(/if \(!isV2ForgetEnabled\(userId\)\)/);
  });
});
