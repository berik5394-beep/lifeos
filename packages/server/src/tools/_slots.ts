/**
 * SSOT Step 3b — чистая логика поиска свободных окон. Вынесена сюда
 * (не зависит от legacy action-executor switch, который сносят на
 * Шаге 9). Поведение 1:1 с прежним findFreeSlots — без дрейфа.
 */

export interface FreeSlot {
  date: string;
  from: string;
  to: string;
  durationMinutes: number;
}

export function timeDiff(from: string, to: string): number {
  const [h1, m1] = from.split(':').map(Number);
  const [h2, m2] = to.split(':').map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

export function findFreeSlots(
  events: Array<{ date: Date; startTime: string | null; endTime: string | null }>,
  dateFrom: Date,
  dateTo: Date,
  minDurationMinutes: number,
): FreeSlot[] {
  const slots: FreeSlot[] = [];
  const WORK_START = '09:00';
  const WORK_END = '20:00';

  for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayEvents = events
      .filter(
        (e) =>
          e.date.toISOString().split('T')[0] === dateStr &&
          e.startTime &&
          e.endTime,
      )
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    let currentStart = WORK_START;
    for (const event of dayEvents) {
      if (event.startTime && event.startTime > currentStart) {
        const duration = timeDiff(currentStart, event.startTime);
        if (duration >= minDurationMinutes) {
          slots.push({
            date: dateStr,
            from: currentStart,
            to: event.startTime,
            durationMinutes: duration,
          });
        }
      }
      if (event.endTime && event.endTime > currentStart) {
        currentStart = event.endTime;
      }
    }
    if (currentStart < WORK_END) {
      const duration = timeDiff(currentStart, WORK_END);
      if (duration >= minDurationMinutes) {
        slots.push({
          date: dateStr,
          from: currentStart,
          to: WORK_END,
          durationMinutes: duration,
        });
      }
    }
  }
  return slots;
}
