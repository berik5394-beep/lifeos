import { bestWeekday } from '@/utils/task-stats';

const t = (date: string, completed: boolean) => ({ date, completed });

describe('лучший день недели', () => {
  it('нет задач или мало закрытых → null, а не «Понедельник»', () => {
    expect(bestWeekday([])).toBeNull();
    expect(bestWeekday([t('2026-11-04', true), t('2026-11-05', true)])).toBeNull();
  });
  it('считает по доле выполненных; дата ISO с полуночью UTC — тот же день', () => {
    // 2026-11-04 — среда (2), 2026-11-06 — пятница (4)
    const tasks = [
      t('2026-11-04T00:00:00.000Z', true), t('2026-11-04', true), t('2026-11-04', true),
      t('2026-11-06', true), t('2026-11-06', true), t('2026-11-06', false), t('2026-11-06', false),
    ];
    expect(bestWeekday(tasks)).toBe(2);
  });
});
