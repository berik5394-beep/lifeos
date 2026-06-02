import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = readFileSync(join(process.cwd(), 'src/services/reflector-core.ts'), 'utf-8');
const SVC = readFileSync(join(process.cwd(), 'src/services/reflector-service.ts'), 'utf-8');

describe('ReflectorFacts расширены под коуча', () => {
  it('интерфейс несёт savedSoFar/targetDate/pacingEnabled/now', () => {
    expect(CORE).toMatch(/savedSoFar:\s*number/);
    expect(CORE).toMatch(/targetDate:\s*Date/);
    expect(CORE).toMatch(/pacingEnabled:\s*boolean/);
    expect(CORE).toMatch(/now:\s*Date/);
  });
  it('gatherReflectorFacts: savedSoFar с ДАТЫ ПОСТАНОВКИ цели + pacingEnabled по флагу', () => {
    expect(SVC).toContain('isV2SavingsCoachEnabled');
    expect(SVC).toContain('savedSoFar');
    expect(SVC).toContain('targetDate');
    // Копим ОТ даты цели (createdAt), не с 1 января — иначе короткая
    // цель читается как уже достигнутая из годового профицита.
    expect(SVC).toContain('createdAt');
    // Среди НЕСКОЛЬКИХ фин-целей берём не достигнутую (живой баг 2026-06-02:
    // find брал первую — уже достигнутую — и коуч молчал на отстающей).
    expect(SVC).toContain('pickCoachableGoal');
  });
  it('gatherReflectorFacts экспортирован (для переиспользования коучем)', () => {
    expect(SVC).toMatch(/export\s+async\s+function\s+gatherReflectorFacts/);
  });
});
