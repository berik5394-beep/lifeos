import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHED = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'), 'utf-8');

describe('scheduler wiring', () => {
  it('calls both runners (без флага — для всех)', () => {
    expect(SCHED).not.toMatch(/isV2ReflectorEnabled/);
    expect(SCHED).toMatch(/runWeekly/);
    expect(SCHED).toMatch(/runEventCheck/);
  });
});
