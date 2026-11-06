import {
  buildMonthMatrix,
  computeDayStats,
  dayMarker,
  heatColor,
  type DayStat,
} from '@/components/calendar/calendar-logic';

describe('buildMonthMatrix', () => {
  it('июнь 2026: 1 июня = понедельник → первая ячейка = 1 июня', () => {
    const weeks = buildMonthMatrix(2026, 5); // month 0-based: 5=июнь
    expect(weeks[0][0].dateKey).toBe('2026-06-01');
    expect(weeks[0][0].inMonth).toBe(true);
  });

  it('каждая неделя = 7 дней, все дни месяца присутствуют', () => {
    const weeks = buildMonthMatrix(2026, 5);
    for (const w of weeks) expect(w).toHaveLength(7);
    const keys = weeks.flat().filter((d) => d.inMonth).map((d) => d.dateKey);
    expect(keys).toContain('2026-06-30');
    expect(keys.filter((k) => k.startsWith('2026-06')).length).toBe(30);
  });

  it('дни соседних месяцев помечены inMonth=false', () => {
    // май 2026: 1 мая = пятница → первые 4 ячейки = дни апреля
    const weeks = buildMonthMatrix(2026, 4);
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][4].dateKey).toBe('2026-05-01');
    expect(weeks[0][4].inMonth).toBe(true);
  });
});

describe('computeDayStats', () => {
  const today = new Date(2026, 5, 15); // 15 июня 2026

  it('считает done/total/donePct по дате', () => {
    const tasks = [
      { date: '2026-06-10', completed: true },
      { date: '2026-06-10', completed: false },
      { date: '2026-06-10', completed: true },
    ];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-10']).toEqual<DayStat>({
      total: 3,
      done: 2,
      donePct: 67,
      hasOverdue: true, // прошлый день + есть невыполненная
    });
  });

  it('день без задач отсутствует в карте', () => {
    const stats = computeDayStats([], today);
    expect(stats['2026-06-10']).toBeUndefined();
  });

  it('hasOverdue=false для будущего дня с невыполненной задачей', () => {
    const tasks = [{ date: '2026-06-20', completed: false }];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-20'].hasOverdue).toBe(false);
  });

  it('hasOverdue=false если все выполнены (даже в прошлом)', () => {
    const tasks = [{ date: '2026-06-10', completed: true }];
    const stats = computeDayStats(tasks, today);
    expect(stats['2026-06-10'].hasOverdue).toBe(false);
  });
});

describe('dayMarker', () => {
  const full: DayStat = { total: 2, done: 2, donePct: 100, hasOverdue: false };
  const partialPast: DayStat = { total: 2, done: 1, donePct: 50, hasOverdue: true };

  it('check при 100% (приоритет над всем)', () => {
    expect(dayMarker(full, true, true)).toBe('check');
  });
  it('cross при прошлом дне с невыполненным', () => {
    expect(dayMarker(partialPast, false, true)).toBe('cross');
  });
  it('будущий частичный день → не cross', () => {
    const partialFuture: DayStat = { total: 2, done: 1, donePct: 50, hasOverdue: false };
    expect(dayMarker(partialFuture, false, false)).toBe('none');
  });
  it('dot когда есть событие и нет check/cross', () => {
    expect(dayMarker(undefined, true, false)).toBe('dot');
  });
  it('none для пустого дня без событий', () => {
    expect(dayMarker(undefined, false, true)).toBe('none');
  });
});

describe('heatColor', () => {
  it('0% → surface цвет', () => {
    expect(heatColor(0, '#1E293B')).toBe('#1E293B');
  });
  it('границы шкалы', () => {
    expect(heatColor(25, '#1E293B')).toBe('#064E3B');
    expect(heatColor(50, '#1E293B')).toBe('#059669');
    expect(heatColor(75, '#1E293B')).toBe('#34D399');
    expect(heatColor(100, '#1E293B')).toBe('#22C55E');
  });
});

describe('цвет задачи = важность', () => {
  const { dayPriorityColors, nextPriority, priorityColor } = jest.requireActual('@/components/calendar/calendar-logic');

  it('тап по точке меняет цвет по кругу: зелёный → синий → оранжевый → красный → зелёный', () => {
    expect(nextPriority('low')).toBe('medium');
    expect(nextPriority('medium')).toBe('high');
    expect(nextPriority('high')).toBe('critical');
    expect(nextPriority('critical')).toBe('low');
    expect(nextPriority(undefined)).toBe('high'); // без важности считаем «средней»
  });

  it('на числе — цвета невыполненных задач, красные первыми, без повторов, не больше 3', () => {
    const colors = dayPriorityColors([
      { date: '2026-11-06', completed: false, priority: 'low' },
      { date: '2026-11-06', completed: false, priority: 'critical' },
      { date: '2026-11-06', completed: false, priority: 'critical' },
      { date: '2026-11-06', completed: false, priority: 'high' },
      { date: '2026-11-06', completed: false, priority: 'medium' },
      { date: '2026-11-06', completed: true, priority: 'critical' },
      { date: '2026-11-07', completed: true, priority: 'low' },
    ]);
    expect(colors['2026-11-06']).toEqual([priorityColor('critical'), priorityColor('high'), priorityColor('medium')]);
    expect(colors['2026-11-07']).toBeUndefined(); // всё выполнено — точек нет
  });
});

describe('дата с сервера полной ISO-строкой', () => {
  const { computeDayStats: stats, dayPriorityColors: colors } = jest.requireActual('@/components/calendar/calendar-logic');
  it('задача с датой «2026-11-06T00:00:00.000Z» попадает на 6 ноября (раньше — никуда)', () => {
    const tasks = [{ date: '2026-11-06T00:00:00.000Z', completed: false, priority: 'critical' }];
    expect(stats(tasks, new Date(2026, 10, 6))['2026-11-06'].total).toBe(1);
    expect(colors(tasks)['2026-11-06']).toHaveLength(1);
  });
});
