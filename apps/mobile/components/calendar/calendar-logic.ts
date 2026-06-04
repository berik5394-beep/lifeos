import { formatDate } from '@/utils/dates';

export interface DayStat {
  total: number;
  done: number;
  donePct: number; // 0..100
  hasOverdue: boolean; // прошлый/сегодня день с невыполненной задачей
}

export type DayMarker = 'check' | 'cross' | 'dot' | 'none';

export interface MatrixDay {
  date: Date;
  dateKey: string; // 'YYYY-MM-DD'
  day: number; // число месяца
  inMonth: boolean; // принадлежит отображаемому месяцу
}

/** Минимальная форма задачи, нужная для расчётов (шире — из task-store). */
interface TaskLike {
  date: string;
  completed: boolean;
}

/**
 * Матрица недель месяца. Неделя начинается с понедельника. Первая/последняя
 * недели добиваются днями соседних месяцев (inMonth=false). Возвращает 4-6 недель.
 */
export function buildMonthMatrix(year: number, month: number): MatrixDay[][] {
  const first = new Date(year, month, 1);
  const firstDow = first.getDay(); // 0=вс
  const startOffset = firstDow === 0 ? -6 : 1 - firstDow; // выравнивание на пн
  const start = new Date(year, month, 1 + startOffset);

  const last = new Date(year, month + 1, 0); // последний день месяца

  const weeks: MatrixDay[][] = [];
  const cursor = new Date(start);
  // Идём неделями, пока не покрыли последний день месяца и не закрыли неделю.
  while (cursor <= last || cursor.getDay() !== 1) {
    const week: MatrixDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: new Date(cursor),
        dateKey: formatDate(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month && cursor.getFullYear() === year,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (weeks.length >= 6) break; // защита от бесконечного цикла
  }
  return weeks;
}

/** % выполнения и hasOverdue по каждой дате. День без задач — отсутствует. */
export function computeDayStats(
  tasks: TaskLike[],
  now: Date = new Date(),
): Record<string, DayStat> {
  const todayKey = formatDate(now);
  const agg: Record<string, { total: number; done: number; openCount: number }> = {};
  for (const t of tasks) {
    if (!agg[t.date]) agg[t.date] = { total: 0, done: 0, openCount: 0 };
    agg[t.date].total++;
    if (t.completed) agg[t.date].done++;
    else agg[t.date].openCount++;
  }
  const out: Record<string, DayStat> = {};
  for (const [date, a] of Object.entries(agg)) {
    const donePct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0;
    // hasOverdue: день в прошлом или сегодня И есть незакрытая задача.
    const isPastOrToday = date <= todayKey;
    out[date] = {
      total: a.total,
      done: a.done,
      donePct,
      hasOverdue: isPastOrToday && a.openCount > 0,
    };
  }
  return out;
}

/** Один маркер на ячейку. Приоритет: check > cross > dot > none. */
export function dayMarker(
  stat: DayStat | undefined,
  hasEvent: boolean,
  isPast: boolean,
): DayMarker {
  if (stat && stat.total > 0 && stat.donePct === 100) return 'check';
  if (stat && stat.total > 0 && isPast && stat.hasOverdue) return 'cross';
  if (hasEvent) return 'dot';
  return 'none';
}

/** Цветовая шкала % (та же, что в charts/heatmap). 0 → surface. */
export function heatColor(pct: number, surface: string): string {
  if (pct <= 0) return surface;
  if (pct <= 25) return '#064E3B';
  if (pct <= 50) return '#059669';
  if (pct <= 75) return '#34D399';
  return '#22C55E';
}
