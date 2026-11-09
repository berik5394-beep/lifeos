import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const READER = readFileSync(join(__dirname, 'memory-service.ts'), 'utf8');
const WRITER = readFileSync(join(__dirname, 'episodic-memory.ts'), 'utf8');

describe('forget-triad wiring (гард)', () => {
  it('ридер всегда отсекает message + чтит invalidAt (флаг удалён)', () => {
    expect(READER).not.toContain('isV2ForgetEnabled');
    expect(READER).toContain("m.type <> 'message'");
    expect(READER).toContain('invalidAt');
  });
  it('писатель при дедупе НЕ сбрасывает createdAt (флаг удалён)', () => {
    expect(WRITER).not.toContain('isV2ForgetEnabled');
    expect(WRITER).not.toMatch(/updateData\.createdAt\s*=/);
  });
});
