import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  groupSnapshotsByUserDay,
  runMoodRetention,
} from './mood-retention-cron.js';

const SRC = readFileSync(join(__dirname, 'mood-retention-cron.ts'), 'utf8');

describe('groupSnapshotsByUserDay — pure', () => {
  it('groups by userId|YYYY-MM-DD with mean valence/arousal', () => {
    const rows = [
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.4,
        arousal: 0.2,
        entityRefs: ['e1'],
      },
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T18:00:00Z'),
        valence: 0.6,
        arousal: 0.4,
        entityRefs: ['e2', 'e1'],
      },
    ];
    const out = groupSnapshotsByUserDay(rows);
    expect(out.size).toBe(1);
    const v = out.get('u1|2026-04-01')!;
    expect(v.valence).toBeCloseTo(0.5);
    expect(v.arousal).toBeCloseTo(0.3);
    expect(new Set(v.entityRefs)).toEqual(new Set(['e1', 'e2']));
    expect(v.count).toBe(2);
  });
  it('separates users + days', () => {
    const rows = [
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
      {
        userId: 'u2',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-02T10:00:00Z'),
        valence: 0.5,
        arousal: 0.5,
        entityRefs: [],
      },
    ];
    expect(groupSnapshotsByUserDay(rows).size).toBe(3);
  });
  it('handles empty input', () => {
    expect(groupSnapshotsByUserDay([]).size).toBe(0);
  });
  it('handles null arousal (uses 0)', () => {
    const out = groupSnapshotsByUserDay([
      {
        userId: 'u1',
        recordedAt: new Date('2026-04-01T10:00:00Z'),
        valence: 0.5,
        arousal: null,
        entityRefs: [],
      },
    ]);
    expect(out.get('u1|2026-04-01')!.arousal).toBe(0);
  });
});

describe('structural — runMoodRetention', () => {
  it('uses 30-day cutoff', () => {
    expect(SRC).toMatch(/30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|RETENTION_DAYS\s*=\s*30/);
  });
  it('reads source: "message" snapshots older than cutoff', () => {
    expect(SRC).toMatch(/source:\s*['"]message['"]/);
    expect(SRC).toMatch(/recordedAt:\s*\{\s*lt:/);
  });
  it('writes back source: "daily_agg" rows', () => {
    expect(SRC).toMatch(/source\s*[=:]\s*['"]daily_agg['"]/);
  });
  it('deletes original per-message rows after aggregation', () => {
    expect(SRC).toMatch(/moodSnapshot\.deleteMany/);
  });
  it('wraps everything in try/catch with [cron:mood-retention] log prefix', () => {
    expect(SRC).toMatch(/\[cron:mood-retention\]/);
    expect(SRC).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]{0,300}?\[cron:mood-retention\]/);
  });
  it('never throws — outer catch returns void', () => {
    const body = SRC.slice(SRC.indexOf('export async function runMoodRetention'));
    expect(body).toMatch(/catch/);
    expect(body).not.toMatch(/throw\s+/);
  });
});

describe('runMoodRetention — runtime safety', () => {
  it('does not throw when DB is empty', async () => {
    await expect(runMoodRetention()).resolves.toBeUndefined();
  });
});
