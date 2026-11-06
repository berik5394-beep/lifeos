import { formatDate } from '@/utils/dates';

/** Что правится в карточке задачи. */
export interface TaskDraft {
  title: string;
  category: string;
  priority: string;
  date: string;
  time: string;
  notes: string;
}

export interface EditableTask {
  id: string;
  title: string;
  category: string;
  priority: string;
  date: string;
  time: string | null;
  notes: string | null;
}

export function draftFromTask(t: EditableTask): TaskDraft {
  return {
    title: t.title,
    category: t.category,
    priority: t.priority,
    date: t.date.slice(0, 10),
    time: t.time ?? '',
    notes: t.notes ?? '',
  };
}

/** Быстрые дни: «Сегодня», «Завтра», «Послезавтра» — от локальной даты телефона. */
export function quickDays(now: Date = new Date()): { label: string; date: string }[] {
  return ['Сегодня', 'Завтра', 'Послезавтра'].map((label, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { label, date: formatDate(d) };
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «9:30» → «09:30»; остальное как есть. */
export function normalizeTime(raw: string): string {
  const t = raw.trim().replace('.', ':');
  const m = t.match(/^(\d):(\d{2})$/);
  return m ? `0${m[1]}:${m[2]}` : t;
}

/**
 * Проверка и сборка изменений. Пустое время/заметки = очистить (null), а не
 * «не менять»: раньше `|| undefined` не давал убрать время у задачи.
 */
export function buildUpdate(d: TaskDraft):
  | { ok: true; data: { title: string; category: string; priority: string; date: string; time: string | null; notes: string | null } }
  | { ok: false; error: string } {
  const title = d.title.trim();
  if (!title) return { ok: false, error: 'Напиши, что нужно сделать.' };
  const m = d.date.trim().match(DATE_RE);
  const valid =
    m != null &&
    (() => {
      const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return dt.getMonth() === Number(m[2]) - 1 && dt.getDate() === Number(m[3]);
    })();
  if (!valid) return { ok: false, error: 'Дата в виде ГГГГ-ММ-ДД, например 2026-11-07.' };
  const time = normalizeTime(d.time);
  if (time && !TIME_RE.test(time)) return { ok: false, error: 'Время в виде ЧЧ:ММ, например 14:30.' };
  return {
    ok: true,
    data: {
      title,
      category: d.category,
      priority: d.priority,
      date: d.date.trim(),
      time: time || null,
      notes: d.notes.trim() || null,
    },
  };
}
