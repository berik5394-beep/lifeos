import { sleepHoursFromSamples } from '@/services/health-sync';
import { widgetPayload } from '@/services/widget-sync';

const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m);

describe('сон из «Здоровья»', () => {
  it('только «спал», пересечения часов и телефона — один раз', () => {
    const hours = sleepHoursFromSamples([
      { value: 0, startDate: at(22, 30), endDate: at(23, 59) }, // в кровати — не сон
      { value: 3, startDate: at(23, 0), endDate: new Date(2026, 10, 8, 3, 0) }, // core (часы)
      { value: 1, startDate: new Date(2026, 10, 8, 2, 0), endDate: new Date(2026, 10, 8, 6, 30) }, // телефон, перекрывает
      { value: 2, startDate: new Date(2026, 10, 8, 3, 0), endDate: new Date(2026, 10, 8, 3, 10) }, // проснулся — не сон
    ]);
    expect(hours).toBe(7.5); // 23:00 → 06:30
  });
  it('пусто — 0', () => {
    expect(sleepHoursFromSamples([])).toBe(0);
  });
});

describe('данные для виджета', () => {
  it('плоский JSON под Swift TodayData', () => {
    expect(
      JSON.parse(
        widgetPayload({ date: '2026-11-08', tasksDone: 1, tasksTotal: 3, habitsDone: 1, habitsTotal: 2, next: { time: '15:00', title: 'Встреча' }, topTask: 'Позвонить' }),
      ),
    ).toEqual({ date: '2026-11-08', tasksDone: 1, tasksTotal: 3, habitsDone: 1, habitsTotal: 2, nextTime: '15:00', nextTitle: 'Встреча', topTask: 'Позвонить' });
  });
  it('встреч нет — null-поля', () => {
    const p = JSON.parse(widgetPayload({ date: 'd', tasksDone: 0, tasksTotal: 0, habitsDone: 0, habitsTotal: 0, next: null, topTask: null }));
    expect(p.nextTime).toBeNull();
    expect(p.nextTitle).toBeNull();
  });
});
