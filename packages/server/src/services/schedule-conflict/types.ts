/**
 * Кросс-домен задача↔календарь (слой B): задача с временем пересекается с окном
 * встречи в тот же день. Чистые хелперы — юнит-тест без БД. CLAUDE.md обещает
 * «уведомление при наложении задач и встреч».
 */

/** "HH:MM" → минуты от полуночи, или null если формат/диапазон невалидны. */
export function hmToMinutes(hm: string): number | null {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export type TaskLite = { title: string; time: string };
export type EventLite = { title: string; startTime: string; endTime: string | null };
export type Conflict = {
  taskTitle: string;
  taskTime: string;
  eventTitle: string;
  eventStart: string;
  eventEnd: string | null;
};

/** Окно встречи без endTime считаем 60 мин (встречи обычно не мгновенны). */
const DEFAULT_EVENT_MIN = 60;

/** Задача (точка во времени) попадает в окно [start, end) встречи того же дня. */
export function detectConflicts(tasks: TaskLite[], events: EventLite[]): Conflict[] {
  const out: Conflict[] = [];
  for (const t of tasks) {
    const tm = hmToMinutes(t.time);
    if (tm == null) continue;
    for (const e of events) {
      const start = hmToMinutes(e.startTime);
      if (start == null) continue;
      const endRaw = e.endTime ? hmToMinutes(e.endTime) : null;
      const end = endRaw != null && endRaw > start ? endRaw : start + DEFAULT_EVENT_MIN;
      if (tm >= start && tm < end) {
        out.push({
          taskTitle: t.title,
          taskTime: t.time,
          eventTitle: e.title,
          eventStart: e.startTime,
          eventEnd: e.endTime,
        });
      }
    }
  }
  return out;
}

/** Pure render для врезки в мозг. Пусто → ''. */
export function formatScheduleConflict(conflicts: Conflict[]): string {
  if (!conflicts.length) return '';
  const items = conflicts
    .slice(0, 3)
    .map((c) => {
      const win = c.eventEnd ? `${c.eventStart}–${c.eventEnd}` : c.eventStart;
      return `— задача «${c.taskTitle}» ${c.taskTime} ∩ встреча «${c.eventTitle}» ${win}`;
    })
    .join('\n');
  return `⚠️ Конфликт расписания (предложи перенести):\n${items}`;
}
