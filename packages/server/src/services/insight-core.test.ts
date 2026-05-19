import { describe, it, expect } from 'vitest';
import {
  selectInsights,
  pickForPush,
  type InsightCandidate,
  type ActiveInsight,
} from './insight-core.js';

/**
 * Phase 5 R5 — инварианты ЕДИНОГО dispatch-ядра (чистые функции,
 * без БД/Claude — как registry-consistency/money-safety/capture-gate).
 * TDD-first: доказываем R6/R9/R10 на чистом ядре ДО wiring флэта,
 * чтобы ядро не подстраивалось под уже подключённый код.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-05-19T12:00:00.000Z');

function cand(p: Partial<InsightCandidate> = {}): InsightCandidate {
  return {
    kind: 'budget_over',
    scope: 'budget:food',
    severity: 5,
    message: 'msg',
    source: 'proactive_insights',
    ...p,
  };
}

function active(p: Partial<ActiveInsight> = {}): ActiveInsight {
  return {
    id: 'a1',
    kind: 'budget_over',
    scope: 'budget:food',
    severity: 5,
    createdAt: new Date(NOW.getTime() - 10 * DAY),
    ...p,
  };
}

describe('selectInsights — R10 cooldown (подавление повторов на CREATE)', () => {
  it('активный того же kind+scope СВЕЖЕЕ cooldown → НЕ создаём, НЕ supersede', () => {
    const r = selectInsights(
      [cand()],
      [active({ createdAt: new Date(NOW.getTime() - 1 * DAY) })],
      NOW,
      3,
    );
    expect(r.create).toHaveLength(0);
    expect(r.supersedeIds).toHaveLength(0);
  });

  it('активный другого scope не мешает (cooldown по kind+scope)', () => {
    const r = selectInsights(
      [cand({ scope: 'budget:food' })],
      [
        active({
          scope: 'budget:transport',
          createdAt: new Date(NOW.getTime() - 1 * DAY),
        }),
      ],
      NOW,
      3,
    );
    expect(r.create).toHaveLength(1);
    expect(r.supersedeIds).toHaveLength(0);
  });
});

describe('selectInsights — R9 supersede (старый протух → гасим, новый)', () => {
  it('активный СТАРШЕ cooldown → supersede + создаём свежий с TTL', () => {
    const r = selectInsights(
      [cand({ ttlDays: 7 })],
      [active({ id: 'old1', createdAt: new Date(NOW.getTime() - 5 * DAY) })],
      NOW,
      3,
    );
    expect(r.supersedeIds).toEqual(['old1']);
    expect(r.create).toHaveLength(1);
    expect(r.create[0].expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  it('несколько активных того же scope+kind → гасим ВСЕ', () => {
    const r = selectInsights(
      [cand()],
      [
        active({ id: 'o1', createdAt: new Date(NOW.getTime() - 5 * DAY) }),
        active({ id: 'o2', createdAt: new Date(NOW.getTime() - 6 * DAY) }),
      ],
      NOW,
      3,
    );
    expect(new Set(r.supersedeIds)).toEqual(new Set(['o1', 'o2']));
    expect(r.create).toHaveLength(1);
  });

  it('дефолтный TTL = 7 дней, если ttlDays не задан', () => {
    const r = selectInsights([cand()], [], NOW, 3);
    expect(r.create[0].expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });
});

describe('selectInsights — дедуп ВНУТРИ батча (max severity)', () => {
  it('один kind+scope дважды → остаётся макс severity', () => {
    const r = selectInsights(
      [cand({ severity: 3 }), cand({ severity: 8 }), cand({ severity: 5 })],
      [],
      NOW,
      3,
    );
    expect(r.create).toHaveLength(1);
    expect(r.create[0].severity).toBe(8);
  });

  it('разные scope не схлопываются', () => {
    const r = selectInsights(
      [cand({ scope: 'budget:food' }), cand({ scope: 'budget:transport' })],
      [],
      NOW,
      3,
    );
    expect(r.create).toHaveLength(2);
  });

  it('source сохраняется в плане создания', () => {
    const r = selectInsights(
      [cand({ source: 'reflector' })],
      [],
      NOW,
      3,
    );
    expect(r.create[0].source).toBe('reflector');
  });
});

describe('pickForPush — R6 ровно один (max severity, тай-брейк новейший)', () => {
  it('пусто → null', () => {
    expect(pickForPush([])).toBeNull();
  });

  it('макс severity выигрывает', () => {
    const r = pickForPush([
      { id: 'a', severity: 3, createdAt: new Date(NOW.getTime() - DAY) },
      { id: 'b', severity: 9, createdAt: new Date(NOW.getTime() - 5 * DAY) },
    ]);
    expect(r?.id).toBe('b');
  });

  it('равная severity → новейший', () => {
    const r = pickForPush([
      { id: 'old', severity: 5, createdAt: new Date(NOW.getTime() - 5 * DAY) },
      { id: 'new', severity: 5, createdAt: new Date(NOW.getTime() - DAY) },
    ]);
    expect(r?.id).toBe('new');
  });
});
