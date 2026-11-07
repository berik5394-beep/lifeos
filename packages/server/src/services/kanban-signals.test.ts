import { describe, it, expect } from 'vitest';
import {
  computeKanbanSignals, formatKanbanFacts, kanbanForCompletion, kanbanLabel,
  KANBAN_WIP_LIMIT, KANBAN_STUCK_DAYS,
} from './kanban-signals.js';
import { formatOpenLoopsSection, type OpenLoops } from './open-loops.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

describe('kanbanForCompletion — галочка ⇄ «Готово»', () => {
  it('отметил выполненной → «Готово» + время переезда', () => {
    expect(kanbanForCompletion(true, 'in_progress', NOW)).toEqual({ kanbanStatus: 'done', kanbanMovedAt: NOW });
  });
  it('снял отметку с задачи из «Готово» → «К выполнению»', () => {
    expect(kanbanForCompletion(false, 'done', NOW)).toEqual({ kanbanStatus: 'todo', kanbanMovedAt: NOW });
  });
  it('уже в «Готово» и выполнена / не в «Готово» и не выполнена → колонку не трогаем', () => {
    expect(kanbanForCompletion(true, 'done', NOW)).toEqual({});
    expect(kanbanForCompletion(false, 'backlog', NOW)).toEqual({});
  });
});

describe('computeKanbanSignals', () => {
  it('считает «В работе» и находит зависшие (самые старые первыми, не больше 3)', () => {
    const s = computeKanbanSignals(
      [
        { title: 'свежая', kanbanMovedAt: daysAgo(1) },
        { title: 'сайт', kanbanMovedAt: daysAgo(KANBAN_STUCK_DAYS) },
        { title: 'отчёт', kanbanMovedAt: daysAgo(9) },
        { title: 'старая без даты', kanbanMovedAt: null },
        { title: 'a', kanbanMovedAt: daysAgo(4) },
        { title: 'b', kanbanMovedAt: daysAgo(5) },
      ],
      NOW,
    );
    expect(s.inProgress).toBe(6);
    expect(s.stuck.map((t) => t.title)).toEqual(['отчёт', 'b', 'a']);
    expect(s.stuck[0].days).toBe(9);
  });
  it('без даты переезда — не «завис» (срок неизвестен, не выдумываем)', () => {
    expect(computeKanbanSignals([{ title: 'x', kanbanMovedAt: null }], NOW).stuck).toEqual([]);
  });
});

describe('formatKanbanFacts', () => {
  it('спокойная доска → пусто', () => {
    expect(formatKanbanFacts({ inProgress: KANBAN_WIP_LIMIT, stuck: [] })).toEqual([]);
  });
  it('перебор «В работе» и зависшая → факты с числами', () => {
    const f = formatKanbanFacts({ inProgress: 5, stuck: [{ title: 'сайт', days: 4 }] });
    expect(f[0]).toContain('в работе на канбане 5');
    expect(f[1]).toContain('«сайт»');
    expect(f[1]).toContain('4 дн.');
  });
  it('доходит до блока «Открыто сейчас» для чата', () => {
    const l: OpenLoops = {
      overdueCount: 0, overdueTitles: [], habitsActive: 0, habitsUnchecked: 0, uncheckedHabitNames: [], pendingText: null,
      kanban: { inProgress: 1, stuck: [{ title: 'сайт', days: 5 }] },
    };
    expect(formatOpenLoopsSection(l)).toContain('«сайт» висит «В работе» 5 дн.');
  });
});

describe('kanbanLabel', () => {
  it('колонки по-русски в памяти мозга', () => {
    expect(kanbanLabel('in_progress')).toBe('В работе');
    expect(kanbanLabel('done')).toBe('Готово');
  });
});
