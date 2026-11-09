import { describe, it, expect } from 'vitest';
import { rowCostUsd, summarizeDay, digestText, isOpsDigestHour, type UsageRow } from './ai-economics.js';

const row = (p: Partial<UsageRow>): UsageRow => ({
  userId: 'u1',
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...p,
});

describe('rowCostUsd — цены за 1M токенов', () => {
  it('Sonnet: $3 вход, $15 выход', () => {
    expect(rowCostUsd(row({ inputTokens: 1_000_000, outputTokens: 1_000_000 }))).toBeCloseTo(18, 6);
  });
  it('Haiku: $1 / $5; кэш — чтение 0.1×, запись 1.25× входа', () => {
    expect(
      rowCostUsd(row({ model: 'claude-haiku-4-5', cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })),
    ).toBeCloseTo(0.1 + 1.25, 6);
  });
  it('Opus: $5 / $25', () => {
    expect(rowCostUsd(row({ model: 'claude-opus-4-7', outputTokens: 1_000_000 }))).toBeCloseTo(25, 6);
  });
  it('Whisper — за вызов (минимум 10 с звука), сбой — бесплатно', () => {
    expect(rowCostUsd(row({ provider: 'groq', model: 'whisper', calls: 360 }))).toBeCloseTo(0.04, 6);
    expect(rowCostUsd(row({ model: 'error:billing', inputTokens: 999 }))).toBe(0);
  });
});

describe('summarizeDay', () => {
  it('стоимость на человека включает фон; сбои считаются отдельно', () => {
    const s = summarizeDay(
      '2026-11-09',
      [
        row({ userId: 'u1', inputTokens: 1_000_000 }), // $3
        row({ userId: 'u2', inputTokens: 500_000 }), // $1.5
        row({ userId: 'system', model: 'claude-haiku-4-5', inputTokens: 1_500_000 }), // $1.5
        row({ userId: 'u1', provider: 'groq', model: 'whisper', calls: 10 }),
        row({ userId: 'u1', model: 'error:billing', calls: 3 }),
      ],
      2,
      1,
    );
    expect(s.totalUsd).toBeCloseTo(6 + (0.04 / 360) * 10, 6);
    expect(s.systemUsd).toBeCloseTo(1.5, 6);
    expect(s.perActiveUserUsd).toBeCloseTo(s.totalUsd / 2, 6);
    expect(s.maxUserUsd).toBeCloseTo(3 + (0.04 / 360) * 10, 6);
    expect(s.claudeCalls).toBe(3);
    expect(s.whisperCalls).toBe(10);
    expect(s.failures).toEqual({ 'claude:billing': 3 });
  });
  it('нет людей — нет деления на ноль', () => {
    expect(summarizeDay('2026-11-09', [], 0, 0).perActiveUserUsd).toBeNull();
  });
});

describe('digestText — утренняя сводка по-русски', () => {
  it('люди, деньги, удержание, сбои', () => {
    const s = summarizeDay('2026-11-09', [row({ inputTokens: 100_000 }), row({ model: 'error:auth', calls: 2, provider: 'groq' })], 1, 0);
    const t = digestText(s, { cohortDay: '2026-11-08', cohort: 2, returned: 1 }, { cohortDay: '2026-11-02', cohort: 0, returned: 0 });
    expect(t.title).toBe('📊 LifeOS за 09.11');
    expect(t.body).toContain('Людей: 1.');
    expect(t.body).toContain('$0.300 на человека');
    expect(t.body).toContain('Вернулись: на следующий день 1 из 2.');
    expect(t.body).not.toContain('через неделю'); // пустая когорта не показывается
    expect(t.body).toContain('groq:auth ×2');
  });
  it('без сбоев — так и пишет', () => {
    const t = digestText(summarizeDay('2026-11-09', [], 0, 0), { cohortDay: '', cohort: 0, returned: 0 }, { cohortDay: '', cohort: 0, returned: 0 });
    expect(t.body).toContain('Сбоев моделей не было.');
  });
});

describe('isOpsDigestHour', () => {
  it('09:xx Алматы = 04:xx UTC', () => {
    expect(isOpsDigestHour(new Date('2026-11-10T04:05:00Z'))).toBe(true);
    expect(isOpsDigestHour(new Date('2026-11-10T05:05:00Z'))).toBe(false);
  });
});
