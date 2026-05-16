import { describe, it, expect } from 'vitest';
import { buildInsights, type InsightInput } from './proactive-insights.js';

/**
 * Тесты чистого ядра правил. `now` инъектируется → детерминизм для
 * time-зависимых правил (event-soon, evening-lag, events-brief).
 */

function emptyInput(): InsightInput {
  return {
    staleTasks: [],
    todayEvents: [],
    todayHabitLogs: [],
    activeHabits: [],
    monthExpenses: [],
    budgetLimits: [],
    pet: null,
    upcomingEvents: [],
  };
}

const at = (h: number) => new Date(2026, 4, 16, h, 0, 0); // 16 мая 2026, локальное

describe('buildInsights — задачи', () => {
  it('задача старше 2 дней → инсайт stale с днями', () => {
    const now = at(10);
    const old = new Date(2026, 4, 11); // 5 дней назад
    const out = buildInsights(
      { ...emptyInput(), staleTasks: [{ id: 't1', title: 'Отчёт', date: old, priority: 'high' }] },
      now,
    );
    const stale = out.find((i) => i.id === 'stale_task_t1');
    expect(stale).toBeDefined();
    expect(stale?.category).toBe('tasks');
    expect(stale?.message).toContain('Отчёт');
  });

  it('задача вчерашняя (1 день) — НЕ stale (порог > 2 дней)', () => {
    const now = at(10);
    const yesterday = new Date(2026, 4, 15);
    const out = buildInsights(
      { ...emptyInput(), staleTasks: [{ id: 't1', title: 'X', date: yesterday, priority: 'low' }] },
      now,
    );
    expect(out.find((i) => i.id.startsWith('stale_task'))).toBeUndefined();
  });
});

describe('buildInsights — финансы', () => {
  it('перерасход (>=100%) → critical', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        monthExpenses: [{ category: 'food', _sum: { amount: 12000 } }],
        budgetLimits: [{ category: 'food', monthlyLimit: 10000 }],
      },
      at(10),
    );
    const i = out.find((x) => x.id === 'budget_over_food');
    expect(i?.severity).toBe('critical');
  });

  it('80-99% → warning', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        monthExpenses: [{ category: 'food', _sum: { amount: 8500 } }],
        budgetLimits: [{ category: 'food', monthlyLimit: 10000 }],
      },
      at(10),
    );
    const i = out.find((x) => x.id === 'budget_warn_food');
    expect(i?.severity).toBe('warning');
  });

  it('<80% → нет инсайта по бюджету', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        monthExpenses: [{ category: 'food', _sum: { amount: 5000 } }],
        budgetLimits: [{ category: 'food', monthlyLimit: 10000 }],
      },
      at(10),
    );
    expect(out.find((x) => x.id.startsWith('budget_'))).toBeUndefined();
  });
});

describe('buildInsights — питомец', () => {
  it('мёртв → critical pet_dead', () => {
    const out = buildInsights(
      { ...emptyInput(), pet: { isAlive: false, health: 0, streak: 0, name: 'Барс', level: 3 } },
      at(10),
    );
    const i = out.find((x) => x.id === 'pet_dead');
    expect(i?.severity).toBe('critical');
    expect(i?.message).toContain('умер');
  });

  it('болеет (health<30) → warning pet_sick', () => {
    const out = buildInsights(
      { ...emptyInput(), pet: { isAlive: true, health: 20, streak: 0, name: 'Барс', level: 3 } },
      at(10),
    );
    expect(out.find((x) => x.id === 'pet_sick')?.severity).toBe('warning');
  });

  it('серия >=7 → info pet_streak', () => {
    const out = buildInsights(
      { ...emptyInput(), pet: { isAlive: true, health: 90, streak: 9, name: 'Барс', level: 5 } },
      at(10),
    );
    expect(out.find((x) => x.id === 'pet_streak_9')?.severity).toBe('info');
  });
});

describe('buildInsights — события', () => {
  it('событие в пределах часа → warning event_soon', () => {
    const now = at(10);
    const out = buildInsights(
      {
        ...emptyInput(),
        upcomingEvents: [{ title: 'Встреча', date: now, startTime: '10:30' }],
      },
      now,
    );
    const i = out.find((x) => x.id.startsWith('event_soon_'));
    expect(i?.severity).toBe('warning');
    expect(i?.message).toContain('Встреча');
  });

  it('событие через 3 часа — НЕ event_soon', () => {
    const now = at(10);
    const out = buildInsights(
      {
        ...emptyInput(),
        upcomingEvents: [{ title: 'Поздно', date: now, startTime: '13:00' }],
      },
      now,
    );
    expect(out.find((x) => x.id.startsWith('event_soon_'))).toBeUndefined();
  });
});

describe('buildInsights — привычки', () => {
  it('вечер (>=18ч) и <30% закрыто → мягкий пинок', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        activeHabits: [
          { id: 'h1', name: 'A' },
          { id: 'h2', name: 'B' },
          { id: 'h3', name: 'C' },
          { id: 'h4', name: 'D' },
        ],
        todayHabitLogs: [],
      },
      at(19),
    );
    expect(out.find((x) => x.id === 'habits_evening_lag')).toBeDefined();
  });

  it('все привычки закрыты (>=3) → похвала', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        activeHabits: [
          { id: 'h1', name: 'A' },
          { id: 'h2', name: 'B' },
          { id: 'h3', name: 'C' },
        ],
        todayHabitLogs: [{ habitId: 'h1' }, { habitId: 'h2' }, { habitId: 'h3' }],
      },
      at(20),
    );
    expect(out.find((x) => x.id === 'habits_all_done')).toBeDefined();
  });
});

describe('buildInsights — сортировка и лимит', () => {
  it('critical идёт раньше info, максимум 7', () => {
    const old = new Date(2026, 4, 10);
    const out = buildInsights(
      {
        ...emptyInput(),
        pet: { isAlive: false, health: 0, streak: 0, name: 'Барс', level: 1 },
        monthExpenses: [{ category: 'food', _sum: { amount: 99999 } }],
        budgetLimits: [{ category: 'food', monthlyLimit: 10000 }],
        staleTasks: [{ id: 't1', title: 'X', date: old, priority: 'low' }],
      },
      at(10),
    );
    expect(out.length).toBeLessThanOrEqual(7);
    expect(out[0].severity).toBe('critical');
  });
});
