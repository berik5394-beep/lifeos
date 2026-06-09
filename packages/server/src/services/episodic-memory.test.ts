import { describe, it, expect } from 'vitest';
import {
  validateEventInput,
  clampMood,
  shouldEmbed,
  writeMemory,
  rankBySignificance,
} from './episodic-memory.js';
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

describe('shouldEmbed — условный embedding по типу/knob (pure)', () => {
  it('explicit embed:false → false (даже для message)', () => {
    expect(shouldEmbed({ type: 'message', content: 'x', embed: false })).toBe(false);
  });

  it('explicit embed:true → true (даже для action-типа)', () => {
    expect(shouldEmbed({ type: 'task_created', content: 'x', embed: true })).toBe(true);
  });

  it('default (no embed knob): message → true (recall-ценный чат-факт)', () => {
    expect(shouldEmbed({ type: 'message', content: 'x' })).toBe(true);
  });

  it('default (no embed knob): fact → true (стабильный recall-ценный)', () => {
    expect(shouldEmbed({ type: 'fact', content: 'x' })).toBe(true);
  });

  it.each(['task_created', 'expense_added', 'habit_logged', 'journal_logged'])(
    'default: высокочастотный action-тип %s → false (FTS хватает, бюджет)',
    (type) => {
      expect(shouldEmbed({ type, content: 'x' })).toBe(false);
    },
  );
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

describe('episodic-memory.ts structural — query methods wiring', () => {
  it('getEventsForEntity exported as async function', () => {
    expect(SRC).toMatch(/export async function getEventsForEntity\s*\(/);
  });

  it('getEventsForEntity filters by entityRefs has', () => {
    const start = SRC.indexOf('export async function getEventsForEntity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('entityRefs:');
    expect(body).toContain('has:');
  });

  it('getEventsForEntity excludes invalidated by default', () => {
    const start = SRC.indexOf('export async function getEventsForEntity');
    const body = SRC.slice(start, start + 1200);
    expect(body).toContain('invalidAt:');
    expect(body).toContain('null');
    expect(body).toContain('includeInvalid');
  });

  it('lastEventForEntity exported + uses findFirst orderBy validAt desc', () => {
    expect(SRC).toMatch(/export async function lastEventForEntity\s*\(/);
    const start = SRC.indexOf('export async function lastEventForEntity');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.findFirst');
    expect(body).toMatch(/orderBy:\s*\{\s*validAt:\s*['"]desc['"]/);
  });

  it('entityFrequency exported + uses count with date filter', () => {
    expect(SRC).toMatch(/export async function entityFrequency\s*\(/);
    const start = SRC.indexOf('export async function entityFrequency');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('prisma.memory.count');
    expect(body).toContain('validAt:');
    expect(body).toContain('gte:');
  });

  it('entityFrequency excludes invalidated', () => {
    const start = SRC.indexOf('export async function entityFrequency');
    const body = SRC.slice(start, start + 800);
    expect(body).toContain('invalidAt:');
    expect(body).toContain('null');
  });
});

describe('episodic-memory.ts structural — writeMemory (единый писатель)', () => {
  it('writeMemory экспортирован как async function', () => {
    expect(SRC).toMatch(/export async function writeMemory\s*\(/);
  });

  it('дедуп: STABLE_TYPES + дубликат-$queryRaw по русскому FTS', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('STABLE_TYPES.has(');
    expect(body).toContain('$queryRaw');
    expect(body).toMatch(/to_tsvector\('russian'/);
    expect(body).toMatch(/plainto_tsquery\('russian'/);
  });

  it('update-ветка зовёт shouldOverwriteContent и берёт importance = max', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('shouldOverwriteContent(');
    expect(body).toMatch(/Math\.max\(/);
    expect(body).toContain('prisma.memory.update');
  });

  it('create-ветка пишет episodic-поля (validAt/entityRefs/mood) + tags', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('prisma.memory.create');
    expect(body).toContain('validAt');
    expect(body).toContain('entityRefs');
    expect(body).toContain('mood');
    expect(body).toContain('tags');
  });

  it('условный embedding: shouldEmbed + embeddingsEnabled + UPDATE embedding', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('shouldEmbed(');
    expect(body).toContain('embeddingsEnabled()');
    expect(body).toMatch(/UPDATE "Memory" SET embedding/);
    expect(body).toContain('embedDocument(');
  });

  it('never-throws: тело обёрнуто в try/catch (best-effort)', () => {
    const start = SRC.indexOf('export async function writeMemory');
    const body = SRC.slice(start, start + 4000);
    expect(body).toContain('try {');
    expect(body).toMatch(/catch\s*\(/);
    expect(body).toMatch(/console\.warn\(\s*['`]\[memory\]/);
  });
});

describe('rankBySignificance (E2)', () => {
  const now = new Date('2026-06-09T12:00:00Z');
  const row = (id: string, importance: number, ageDays: number) => ({
    id, type: 'fact', content: id,
    createdAt: new Date(now.getTime() - ageDays * 86_400_000), importance,
  });

  it('важное старое обходит свежий пустяк', () => {
    const fresh = row('fresh', 3, 0);   // 3 + 2 = 5
    const oldImp = row('oldImp', 9, 30); // 9 + 0 = 9
    const out = rankBySignificance([fresh, oldImp], 6, now);
    expect(out[0].id).toBe('oldImp');
  });
  it('тай-брейк по свежести при равном скоре', () => {
    const a = row('a', 5, 1);  // 5 + 2 = 7
    const b = row('b', 7, 30); // 7 + 0 = 7
    const out = rankBySignificance([b, a], 6, now);
    expect(out[0].id).toBe('a');
  });
  it('limit усечение', () => {
    const rows = [row('a', 5, 0), row('b', 5, 1), row('c', 5, 2)];
    expect(rankBySignificance(rows, 2, now)).toHaveLength(2);
  });
  it('пустой вход → пусто', () => {
    expect(rankBySignificance([], 6, now)).toHaveLength(0);
  });
});

describe('episodic-memory.ts structural — recordEvent M2 флаг-делегация', () => {
  it('recordEvent проверяет isV2WriteEnabled', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toContain('isV2WriteEnabled(');
  });

  it('ON-ветка делегирует в writeMemory с маппингом входа', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toMatch(/writeMemory\(\s*userId/);
  });

  it('OFF-ветка сохраняет plain prisma.memory.create (байт-в-байт)', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    expect(body).toContain('prisma.memory.create');
    expect(body).toMatch(/source:\s*['"]v2-episodic['"]/);
  });

  it('recordEvent всё ещё валидирует и клампит до записи', () => {
    const start = SRC.indexOf('export async function recordEvent');
    const body = SRC.slice(start, start + 1800);
    const validateIdx = body.indexOf('validateEventInput(');
    const branchIdx = body.indexOf('isV2WriteEnabled(');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(branchIdx);
    expect(body).toContain('clampMood(');
  });
});
