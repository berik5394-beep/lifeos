import { PANELS, panelRoute, visiblePanels } from '@/services/panels';

describe('panels — инструменты как панели (Часть 3)', () => {
  it('8 панелей в порядке показа (сделки — рядом с задачами)', () => {
    expect(PANELS.map((p) => p.key)).toEqual(['today', 'tasks', 'deals', 'habits', 'goals', 'finance', 'calendar', 'journal']);
  });

  it('panelRoute: ключ с сервера → маршрут навигации; мусор → null', () => {
    expect(panelRoute('tasks')).toBe('Tasks');
    expect(panelRoute('today')).toBe('Dashboard');
    expect(panelRoute('calendar')).toBe('Calendar');
    expect(panelRoute('deals')).toBe('Deals');
    expect(panelRoute('nonsense')).toBeNull();
    expect(panelRoute(null)).toBeNull();
  });

  it('visiblePanels: цели/финансы скрываются по настройке сложности', () => {
    const hideGoalsFinance = (f: string) => f !== 'goals_tab' && f !== 'finance_tab';
    expect(visiblePanels(hideGoalsFinance).map((p) => p.key)).toEqual(['today', 'tasks', 'deals', 'habits', 'calendar', 'journal']);
    expect(visiblePanels(() => true)).toHaveLength(8);
  });

  it('panelRoute: панель, скрытая уровнем интерфейса, не открывается (маршрута нет)', () => {
    const hideFinance = (f: string) => f !== 'finance_tab';
    expect(panelRoute('finance', hideFinance)).toBeNull();
    expect(panelRoute('tasks', hideFinance)).toBe('Tasks');
  });
});

describe('сделки — инструмент прячется, когда сервер ответил 404', () => {
  it('dealsAvailable=false → панели «Сделки» нет, остальные на месте', () => {
    expect(visiblePanels(() => true, { dealsAvailable: false }).map((p) => p.key)).not.toContain('deals');
    expect(visiblePanels(() => true, { dealsAvailable: false })).toHaveLength(7);
    expect(visiblePanels(() => true, { dealsAvailable: true }).map((p) => p.key)).toContain('deals');
  });
  it('dealsAvailable=null (ещё не знаем) → панели нет, пока сервер не ответил', () => {
    expect(visiblePanels(() => true, { dealsAvailable: null }).map((p) => p.key)).not.toContain('deals');
    expect(panelRoute('deals', () => true, { dealsAvailable: null })).toBeNull();
  });
  it('«покажи сделки» при выключенной функции не открывает панель', () => {
    expect(panelRoute('deals', () => true, { dealsAvailable: false })).toBeNull();
    expect(panelRoute('tasks', () => true, { dealsAvailable: false })).toBe('Tasks');
  });
});
