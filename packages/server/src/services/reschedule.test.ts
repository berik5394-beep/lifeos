import { describe, it, expect } from 'vitest';
import {
  planShift,
  goalWarnings,
  horizonWarning,
  describeProposal,
  fmtMinutes,
  parseMoves,
  type ShiftDay,
  type ShiftTask,
  type WeeklyGoalRef,
  type YearlyGoalRef,
} from './reschedule.js';

const T = (id: string, demand: number, importance: number, extra: Partial<ShiftTask> = {}): ShiftTask => ({
  id,
  title: id,
  demand,
  importance,
  priority: 'medium',
  time: null,
  ...extra,
});
const D = (date: string, capacity: number, tasks: ShiftTask[] = []): ShiftDay => ({ date, capacity, tasks });

// Чт 2026-11-12, дальше пт..чт
const ahead = (caps: number[], tasks: ShiftTask[][] = []) =>
  caps.map((c, i) => D(`2026-11-${String(13 + i).padStart(2, '0')}`, c, tasks[i] ?? []));

describe('planShift — что сдвинуть, чтобы день влез', () => {
  it('влезает → не перегружен, переносов нет', () => {
    const p = planShift(D('2026-11-12', 120, [T('a', 60, 1), T('b', 60, 2)]), ahead([600]), 'b');
    expect(p.overloaded).toBe(false);
    expect(p.moves).toEqual([]);
  });

  it('новую задачу не двигаем, даже если она наименее важная', () => {
    const p = planShift(D('2026-11-12', 60, [T('old', 60, 3), T('new', 60, 1)]), ahead([600]), 'new');
    expect(p.moves.map((m) => m.taskId)).toEqual(['old']);
  });

  it('задачи со временем и critical не двигаем', () => {
    const day = D('2026-11-12', 60, [
      T('timed', 60, 1, { time: '10:00' }),
      T('crit', 60, 1, { priority: 'critical' }),
      T('new', 60, 3),
    ]);
    const p = planShift(day, ahead([600]), 'new');
    expect(p.overloaded).toBe(true);
    expect(p.moves).toEqual([]);
    expect(p.stuck).toEqual([]);
  });

  it('сначала low, потом medium; останавливаемся, как только влезло', () => {
    const day = D('2026-11-12', 120, [T('high', 60, 3), T('med', 60, 2), T('low', 60, 1), T('new', 60, 2)]);
    const p = planShift(day, ahead([600]), 'new');
    expect(p.moves.map((m) => m.taskId)).toEqual(['low', 'med']);
  });

  it('ближайший день, куда влезает целиком; каскад не перегружает следующий день', () => {
    // пт свободно 60 мин и уже занято 30; сб — 600
    const day = D('2026-11-12', 0, [T('a', 30, 1), T('b', 30, 1), T('new', 30, 2)]);
    const p = planShift(day, ahead([60, 600], [[T('x', 30, 2)]]), 'new');
    expect(p.moves).toEqual([
      { taskId: 'a', title: 'a', fromDate: '2026-11-12', toDate: '2026-11-13' },
      { taskId: 'b', title: 'b', fromDate: '2026-11-12', toDate: '2026-11-14' },
    ]);
  });

  it('не больше 5 переносов; остаток после них честно виден (after)', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => T(`t${i}`, 30, 1));
    const p = planShift(D('2026-11-12', 0, [...tasks, T('new', 30, 2)]), ahead([600]), 'new');
    expect(p.moves).toHaveLength(5);
    expect(p.after).toBe(120); // 3 оставшихся + новая
  });

  it('подзадачи (fixed) отдельно от родителя не двигаем', () => {
    const p = planShift(D('2026-11-12', 30, [T('sub', 30, 1, { fixed: true }), T('new', 30, 2)]), ahead([600]), 'new');
    expect(p.moves).toEqual([]);
  });

  it('за 7 дней места нет → stuck, не двигаем', () => {
    const day = D('2026-11-12', 0, [T('huge', 900, 1), T('new', 30, 2)]);
    const p = planShift(day, ahead([600, 600, 600, 600, 600, 600, 600]), 'new');
    expect(p.moves).toEqual([]);
    expect(p.stuck).toEqual([{ taskId: 'huge', title: 'huge' }]);
  });
});

describe('goalWarnings — «цели меняются» только по реальным связям', () => {
  const move = (taskId: string, toDate: string) => ({ taskId, title: taskId, fromDate: '2026-11-12', toDate });
  const weekly = new Map<string, WeeklyGoalRef>([
    ['w1', { id: 'w1', goalText: '3 урока', weekStart: '2026-11-09', yearlyId: 'y1' }],
  ]);
  const yearlyBehind = new Map<string, YearlyGoalRef>([['y1', { id: 'y1', goalText: 'Английский B2', behind: true }]]);

  it('перенос за конец недели → цель недели не закроется + отстающая цель года', () => {
    const w = goalWarnings(
      [move('t', '2026-11-16')],
      [{ taskId: 't', planParentId: 'w1', planParentType: 'WeeklyGoal' }],
      weekly,
      yearlyBehind,
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/цели недели «3 урока».*не закроется/);
    expect(w[0]).toMatch(/«Английский B2» и так отстаёт/);
  });

  it('перенос внутри той же недели → без строки', () => {
    const w = goalWarnings(
      [move('t', '2026-11-15')],
      [{ taskId: 't', planParentId: 'w1', planParentType: 'WeeklyGoal' }],
      weekly,
      yearlyBehind,
    );
    expect(w).toEqual([]);
  });

  it('шаг к цели года → «сдвигается на N дн.»', () => {
    const w = goalWarnings(
      [move('t', '2026-11-14')],
      [{ taskId: 't', planParentId: 'y1', planParentType: 'YearlyGoal' }],
      new Map(),
      new Map([['y1', { id: 'y1', goalText: 'Книги', behind: false }]]),
    );
    expect(w).toEqual(['⚠️ «t» — шаг к цели года «Книги» — сдвигается на 2 дн.']);
  });

  it('задача и так была за неделей цели → без строки', () => {
    const w = goalWarnings(
      [{ taskId: 't', title: 't', fromDate: '2026-11-17', toDate: '2026-11-18' }],
      [{ taskId: 't', planParentId: 'w1', planParentType: 'WeeklyGoal' }],
      weekly,
      yearlyBehind,
    );
    expect(w).toEqual([]);
  });

  it('без связей → ни одной строки (антифаб)', () => {
    expect(goalWarnings([move('t', '2026-11-20')], [{ taskId: 't', planParentId: null, planParentType: null }], weekly, yearlyBehind)).toEqual([]);
  });
});

describe('horizonWarning', () => {
  it('влезает → null', () => {
    expect(horizonWarning('month', { demand: 100, capacity: 200, goals: ['A'] })).toBeNull();
  });
  it('перегружен с целями → называет цели', () => {
    expect(horizonWarning('month', { demand: 600, capacity: 300, goals: ['Сдать проект'] })).toBe(
      '⚠️ Месяц перегружен (дел на ~10 ч, свободно ~5 ч) — цели месяца под угрозой: «Сдать проект».',
    );
  });
  it('перегружен без целей → только числа', () => {
    expect(horizonWarning('week', { demand: 90, capacity: 40, goals: [] })).toBe('⚠️ Неделя перегружена: дел на ~1,5 ч, свободно ~40 мин.');
  });
});

describe('describeProposal', () => {
  const base = { overloaded: true, demand: 420, capacity: 300, stuck: [], after: 240 };
  it('переносы + кнопка + предупреждение', () => {
    const text = describeProposal({
      plan: { ...base, moves: [{ taskId: 'a', title: 'Почта', fromDate: '2026-11-12', toDate: '2026-11-13' }] },
      day: '2026-11-12',
      today: '2026-11-11',
      warnings: ['⚠️ X'],
    });
    expect(text).toBe(
      'Завтра день перегружен: дел на ~7 ч, свободно ~5 ч.\nПредлагаю сдвинуть:\n• «Почта» → на пятницу (13.11)\n⚠️ X\nПодтвердить перенос?',
    );
  });
  it('переносы не спасают день → честная строка «даже после этого»', () => {
    const moves = [{ taskId: 'a', title: 'a', fromDate: '2026-11-12', toDate: '2026-11-13' }];
    const text = describeProposal({ plan: { ...base, moves, after: 400 }, day: '2026-11-12', today: '2026-11-12', warnings: [] });
    expect(text.startsWith('Сегодня день перегружен')).toBe(true);
    expect(text).toContain('Даже после этого останется ~6,5 ч дел на ~5 ч');
  });
  it('некуда сдвинуть → честно, без вопроса «подтвердить»', () => {
    const text = describeProposal({
      plan: { ...base, moves: [], stuck: [{ taskId: 'h', title: 'Ремонт' }] },
      day: '2026-11-12',
      today: '2026-11-12',
      warnings: [],
    });
    expect(text).toContain('Неделя забита — для «Ремонт» места нет');
    expect(text).not.toContain('Подтвердить');
  });
});

describe('fmtMinutes / parseMoves', () => {
  it('минуты по-человечески', () => {
    expect(fmtMinutes(40)).toBe('40 мин');
    expect(fmtMinutes(90)).toBe('1,5 ч');
    expect(fmtMinutes(420)).toBe('7 ч');
  });
  it('parseMoves отбрасывает мусор из JSON', () => {
    expect(
      parseMoves({
        moves: [
          { taskId: 'a', title: 'A', fromDate: '2026-11-12', toDate: '2026-11-13' },
          { taskId: 'b', title: 'B', fromDate: 'завтра', toDate: '2026-11-13' },
          null,
        ],
      }),
    ).toHaveLength(1);
    expect(parseMoves({})).toEqual([]);
  });
});
