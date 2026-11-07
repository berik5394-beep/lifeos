/** День недели (0=Пн … 6=Вс) по дате задачи «ГГГГ-ММ-ДД…» — по календарю, без UTC-сдвига. */
function weekdayIdx(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 ? 6 : wd - 1;
}

/** Минимум закрытых задач, чтобы «лучший день» что-то значил. */
export const BEST_DAY_MIN_DONE = 5;

/**
 * Лучший день недели по доле выполненных. null — данных мало (раньше без
 * задач всегда выходил «Понедельник»).
 */
export function bestWeekday(tasks: { date: string; completed: boolean }[]): number | null {
  const byDay: { total: number; done: number }[] = Array.from({ length: 7 }, () => ({ total: 0, done: 0 }));
  let done = 0;
  for (const t of tasks) {
    const b = byDay[weekdayIdx(t.date)];
    b.total++;
    if (t.completed) {
      b.done++;
      done++;
    }
  }
  if (done < BEST_DAY_MIN_DONE) return null;
  let best: number | null = null;
  let bestRate = 0;
  byDay.forEach((b, i) => {
    const rate = b.total > 0 ? b.done / b.total : 0;
    if (rate > bestRate) {
      bestRate = rate;
      best = i;
    }
  });
  return best;
}
