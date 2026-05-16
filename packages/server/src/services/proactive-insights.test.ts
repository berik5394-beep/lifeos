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
    todayTasks: [],
    upcomingTrip: null,
    yearlyGoals: [],
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

describe('buildInsights — кросс-модульные (Phase 4.3)', () => {
  it('задача со временем пересекается со встречей → конфликт', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        todayEvents: [
          { title: 'Созвон', startTime: '14:00', endTime: '15:00', location: null },
        ],
        todayTasks: [{ title: 'Отчёт', time: '14:30', completed: false }],
      },
      at(10),
    );
    expect(out.find((i) => i.id === 'schedule_conflict')?.severity).toBe('warning');
  });

  it('задача в другое время — конфликта нет', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        todayEvents: [
          { title: 'Созвон', startTime: '14:00', endTime: '15:00', location: null },
        ],
        todayTasks: [{ title: 'Отчёт', time: '16:00', completed: false }],
      },
      at(10),
    );
    expect(out.find((i) => i.id === 'schedule_conflict')).toBeUndefined();
  });

  it('выполненная задача не считается конфликтом', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        todayEvents: [
          { title: 'Созвон', startTime: '14:00', endTime: '15:00', location: null },
        ],
        todayTasks: [{ title: 'Отчёт', time: '14:30', completed: true }],
      },
      at(10),
    );
    expect(out.find((i) => i.id === 'schedule_conflict')).toBeUndefined();
  });

  it('поездка скоро + бюджет ≥80% → trip_budget_tight', () => {
    const trip = new Date(2026, 4, 21); // +5 дней от 16 мая
    const out = buildInsights(
      {
        ...emptyInput(),
        upcomingTrip: { destination: 'Стамбул', dateFrom: trip },
        budgetLimits: [{ category: 'food', monthlyLimit: 100000 }],
        monthExpenses: [{ category: 'food', _sum: { amount: 85000 } }],
      },
      at(10),
    );
    expect(out.find((i) => i.id === 'trip_budget_tight')?.severity).toBe('warning');
  });

  it('поездка есть, но бюджет в норме → нет инсайта', () => {
    const trip = new Date(2026, 4, 21);
    const out = buildInsights(
      {
        ...emptyInput(),
        upcomingTrip: { destination: 'Стамбул', dateFrom: trip },
        budgetLimits: [{ category: 'food', monthlyLimit: 100000 }],
        monthExpenses: [{ category: 'food', _sum: { amount: 30000 } }],
      },
      at(10),
    );
    expect(out.find((i) => i.id === 'trip_budget_tight')).toBeUndefined();
  });
});

describe('buildInsights — проактивная память целей (Phase 2.4)', () => {
  // at(10) = 16 мая 2026 → год пройден на ~37%.
  it('цель сильно отстаёт от темпа года → warning', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        yearlyGoals: [{ area: 'finance', goalText: 'Накопить миллион', progress: 0.05 }],
      },
      at(10),
    );
    const i = out.find((x) => x.id === 'goal_behind_finance');
    expect(i?.severity).toBe('warning');
    expect(i?.message).toContain('Накопить миллион');
  });

  it('цель идёт в темпе → нет инсайта', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        yearlyGoals: [{ area: 'health', goalText: 'Зал 3х/нед', progress: 0.5 }],
      },
      at(10),
    );
    expect(out.find((x) => x.id.startsWith('goal_behind'))).toBeUndefined();
  });

  it('прогресс в шкале 0..100 тоже нормализуется', () => {
    const out = buildInsights(
      {
        ...emptyInput(),
        yearlyGoals: [{ area: 'career', goalText: 'Сменить работу', progress: 4 }],
      },
      at(10),
    );
    expect(out.find((x) => x.id === 'goal_behind_career')?.severity).toBe('warning');
  });

  it('в начале года (рано судить) — инсайта нет', () => {
    const jan = new Date(2026, 0, 10, 10); // ~2.5% года
    const out = buildInsights(
      {
        ...emptyInput(),
        yearlyGoals: [{ area: 'finance', goalText: 'X', progress: 0 }],
      },
      jan,
    );
    expect(out.find((x) => x.id.startsWith('goal_behind'))).toBeUndefined();
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
