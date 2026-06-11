import { describe, it, expect } from 'vitest';
import {
  formatOpenLoopsSection, shouldNudgeOpenLoops,
  OPEN_LOOP_OVERDUE_THRESHOLD, OPEN_LOOP_TOTAL_THRESHOLD, type OpenLoops,
} from './open-loops.js';

const base: OpenLoops = { overdueCount: 0, overdueTitles: [], habitsActive: 0, habitsUnchecked: 0, uncheckedHabitNames: [], pendingText: null };

describe('formatOpenLoopsSection', () => {
  it('всё закрыто → null', () => { expect(formatOpenLoopsSection(base)).toBeNull(); });
  it('просрочки+привычки+pending → строка', () => {
    const s = formatOpenLoopsSection({ ...base, overdueCount: 3, overdueTitles: ['отчёт', 'позвонить'], habitsActive: 4, habitsUnchecked: 2, uncheckedHabitNames: ['зарядка'], pendingText: 'подтвердить расход' });
    expect(s).toContain('просрочено 3'); expect(s).toContain('отчёт');
    expect(s).toContain('привычки 2/4'); expect(s).toContain('ждёт подтверждение');
  });
  it('просрочек больше чем имён → «…»', () => {
    const s = formatOpenLoopsSection({ ...base, overdueCount: 5, overdueTitles: ['a', 'b', 'c'] });
    expect(s).toContain('…');
  });
});
describe('shouldNudgeOpenLoops', () => {
  it('≥4 просрочки → true', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: OPEN_LOOP_OVERDUE_THRESHOLD })).toBe(true); });
  it('сумма≥6 → true', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: 3, habitsUnchecked: 3 })).toBe(true); });
  it('1-2 петли → false', () => { expect(shouldNudgeOpenLoops({ ...base, overdueCount: 2, habitsUnchecked: 1 })).toBe(false); });
  it('пороги экспортируются', () => { expect(OPEN_LOOP_OVERDUE_THRESHOLD).toBe(4); expect(OPEN_LOOP_TOTAL_THRESHOLD).toBe(6); });
});
