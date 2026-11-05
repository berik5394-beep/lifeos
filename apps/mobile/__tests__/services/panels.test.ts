import { PANELS, panelRoute, visiblePanels } from '@/services/panels';

describe('panels — инструменты как панели (Часть 3)', () => {
  it('7 панелей в порядке показа', () => {
    expect(PANELS.map((p) => p.key)).toEqual(['today', 'tasks', 'habits', 'goals', 'finance', 'calendar', 'journal']);
  });

  it('panelRoute: ключ с сервера → маршрут навигации; мусор → null', () => {
    expect(panelRoute('tasks')).toBe('Tasks');
    expect(panelRoute('today')).toBe('Dashboard');
    expect(panelRoute('calendar')).toBe('Calendar');
    expect(panelRoute('nonsense')).toBeNull();
    expect(panelRoute(null)).toBeNull();
  });

  it('visiblePanels: цели/финансы скрываются по настройке сложности', () => {
    const hideGoalsFinance = (f: string) => f !== 'goals_tab' && f !== 'finance_tab';
    expect(visiblePanels(hideGoalsFinance).map((p) => p.key)).toEqual(['today', 'tasks', 'habits', 'calendar', 'journal']);
    expect(visiblePanels(() => true)).toHaveLength(7);
  });
});
