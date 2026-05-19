import { describe, it, expect } from 'vitest';
import {
  selectInsights,
  pickForPush,
  flatInsightToCandidate,
  joinFeed,
  withinQuietHours,
  chooseInsightToPush,
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

describe('flatInsightToCandidate — адаптер плоского движка (R5)', () => {
  it('severity info|warning|critical → 3|6|9', () => {
    const base = { id: 'x', category: 'finance', title: 't', message: 'm' };
    expect(flatInsightToCandidate({ ...base, severity: 'info' }).severity).toBe(3);
    expect(flatInsightToCandidate({ ...base, severity: 'warning' }).severity).toBe(6);
    expect(
      flatInsightToCandidate({ ...base, severity: 'critical' }).severity,
    ).toBe(9);
  });

  it('kind=category, scope=id, source=proactive_insights, rationale=title', () => {
    const c = flatInsightToCandidate({
      id: 'budget_over_food',
      severity: 'critical',
      category: 'finance',
      title: 'Бюджет превышен',
      message: 'msg',
      dismissKey: 'budget_over_food_2026_5',
    });
    expect(c.kind).toBe('finance');
    expect(c.scope).toBe('budget_over_food');
    expect(c.source).toBe('proactive_insights');
    expect(c.rationale).toBe('Бюджет превышен');
    expect(c.dismissKey).toBe('budget_over_food_2026_5');
  });

  it('НЕ выдумывает suggestedAction (честность — flat.actionable = UI, не tool)', () => {
    const c = flatInsightToCandidate({
      id: 'x',
      severity: 'info',
      category: 'tasks',
      title: 't',
      message: 'm',
    });
    expect(c.suggestedAction).toBeUndefined();
  });

  it('адаптер + selectInsights: два прохода одного flat-инсайта → cooldown', () => {
    const f: Parameters<typeof flatInsightToCandidate>[0] = {
      id: 'budget_over_food',
      severity: 'critical',
      category: 'finance',
      title: 't',
      message: 'm',
    };
    const c = flatInsightToCandidate(f);
    const first = selectInsights([c], [], NOW, 3);
    expect(first.create).toHaveLength(1);
    // Имитируем активный из первого прохода, второй прогон в cooldown.
    const r2 = selectInsights(
      [c],
      [
        {
          id: 'persisted1',
          kind: c.kind,
          scope: c.scope,
          severity: c.severity,
          createdAt: new Date(NOW.getTime() - DAY),
        },
      ],
      NOW,
      3,
    );
    expect(r2.create).toHaveLength(0);
    expect(r2.supersedeIds).toHaveLength(0);
  });
});

describe('joinFeed — R5.4 гибрид (таблица=lifecycle, payload=compute)', () => {
  const computed = [
    { id: 'budget_over_food', title: 'A' },
    { id: 'stale_task_1', title: 'B' },
    { id: 'pet_sick', title: 'C' },
  ];

  it('фид = computed ∩ активные scopeKeys, порядок compute сохранён', () => {
    const r = joinFeed(computed, new Set(['pet_sick', 'budget_over_food']));
    expect(r.map((x) => x.id)).toEqual(['budget_over_food', 'pet_sick']);
  });

  it('пустой Set (персист упал) → computed как есть (резильентно)', () => {
    expect(joinFeed(computed, new Set())).toEqual(computed);
  });

  it('scopeKey без payload (условие ушло) просто не появляется', () => {
    const r = joinFeed(computed, new Set(['gone_key', 'stale_task_1']));
    expect(r.map((x) => x.id)).toEqual(['stale_task_1']);
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

describe('withinQuietHours — R11 тихие часы (tz-агностично)', () => {
  it('ночь [22..24) → тихо', () => {
    expect(withinQuietHours(22, 7)).toBe(true);
    expect(withinQuietHours(23, 7)).toBe(true);
  });
  it('до пробуждения [0..wakeUp) → тихо', () => {
    expect(withinQuietHours(3, 7)).toBe(true);
    expect(withinQuietHours(6, 7)).toBe(true);
  });
  it('день [wakeUp..22) → можно', () => {
    expect(withinQuietHours(7, 7)).toBe(false);
    expect(withinQuietHours(13, 7)).toBe(false);
    expect(withinQuietHours(21, 7)).toBe(false);
  });
});

describe('chooseInsightToPush — R6 ≤1/день + R11 + top-severity', () => {
  const u = [
    { id: 'low', severity: 3, createdAt: new Date(NOW.getTime() - DAY) },
    { id: 'hi', severity: 8, createdAt: new Date(NOW.getTime() - 2 * DAY) },
  ];
  it('уже доставляли сегодня → null (не спамим)', () => {
    expect(chooseInsightToPush(u, 13, 7, true)).toBeNull();
  });
  it('тихие часы → null (придёт после пробуждения)', () => {
    expect(chooseInsightToPush(u, 3, 7, false)).toBeNull();
  });
  it('день + не доставляли → top-severity', () => {
    expect(chooseInsightToPush(u, 13, 7, false)?.id).toBe('hi');
  });
  it('пусто → null', () => {
    expect(chooseInsightToPush([], 13, 7, false)).toBeNull();
  });
});
