import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresUserAxes } from './postgres-impl.js';

const SRC = readFileSync(
  join(process.cwd(), 'src/services/user-axes/postgres-impl.ts'),
  'utf-8',
);

describe('PostgresUserAxes — class shape', () => {
  it('class exported', () => {
    expect(PostgresUserAxes).toBeDefined();
    expect(typeof PostgresUserAxes).toBe('function');
  });
  it('implements all UserAxesStore methods', () => {
    const inst = new PostgresUserAxes();
    expect(typeof inst.getAxes).toBe('function');
    expect(typeof inst.recordSignals).toBe('function');
    expect(typeof inst.recentSignals).toBe('function');
    expect(typeof inst.recomputeFromSignals).toBe('function');
  });
});

describe('postgres-impl.ts structural — getAxes', () => {
  it('reads UserAxes via Prisma findUnique', () => {
    const start = SRC.indexOf('async getAxes');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.userAxes.findUnique');
    expect(body).toContain('userId');
  });
  it('auto-initialises missing row with defaults', () => {
    const start = SRC.indexOf('async getAxes');
    const body = SRC.slice(start, start + 2500);
    // Should create row with defaults if findUnique returns null.
    expect(body).toMatch(/prisma\.userAxes\.create/);
    expect(body).toContain('AXIS_DEFAULTS');
  });
  it('returns shape matches UserAxesValues', () => {
    const start = SRC.indexOf('async getAxes');
    const body = SRC.slice(start, start + 2500);
    expect(body).toContain('selfDiscipline');
    expect(body).toContain('emotionalOpenness');
    expect(body).toContain('conflictTolerance');
    expect(body).toContain('introspectionDepth');
    expect(body).toContain('signalCount');
    expect(body).toContain('lastSignalAt');
  });
});

describe('postgres-impl.ts structural — recordSignals', () => {
  it('bulk-inserts AxisSignal rows', () => {
    const start = SRC.indexOf('async recordSignals');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.axisSignal.createMany');
  });
  it('uses EWMA via applyEwma helper', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('applyEwma');
  });
  it('updates UserAxes row with new values + signalCount + lastSignalAt', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.userAxes.update');
    expect(body).toContain('signalCount');
    expect(body).toContain('lastSignalAt');
  });
  it('best-effort: top-level try/catch returns counts on failure', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 4500);
    expect(body).toMatch(/try \{/);
    expect(body).toMatch(/catch/);
    expect(body).toMatch(/\bwritten\b/);
    expect(body).toMatch(/\bskipped\b/);
  });
  it('accepts optional source parameter with default claude_classifier', () => {
    const start = SRC.indexOf('async recordSignals');
    const body = SRC.slice(start, start + 1000);
    expect(body).toMatch(/source\s*[:=].*claude_classifier/);
  });
});
