import { taskCategories } from '@/constants';
import { formatDate } from '@/utils/dates';

export const KANBAN_COLUMNS = [
  { id: 'backlog', label: 'Бэклог', short: 'Бэклог', color: '#6B7280' },
  { id: 'todo', label: 'К выполнению', short: 'К делу', color: '#3B82F6' },
  { id: 'in_progress', label: 'В работе', short: 'В работе', color: '#F59E0B' },
  { id: 'done', label: 'Готово', short: 'Готово', color: '#22C55E' },
] as const;

export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number]['id'];

/** Больше дел «В работе» — колонка подсвечивается (тот же порог, что у робота). */
export const WIP_LIMIT = 3;

/**
 * В какой колонке карточка. Галочка главнее колонки: выполненная задача —
 * в «Готово», даже если отмечена в списке задач или голосом; снятая галочка
 * у задачи из «Готово» — «К выполнению». Так доска и список не расходятся.
 */
export function columnOf(t: { kanbanStatus?: string; completed: boolean }): KanbanColumnId {
  if (t.completed) return 'done';
  const s = t.kanbanStatus || 'todo';
  if (s === 'done') return 'todo';
  return (KANBAN_COLUMNS.some((c) => c.id === s) ? s : 'todo') as KanbanColumnId;
}

/** Категория по-русски с иконкой (раньше на карточке было «personal»). */
export function categoryLabel(category: string): string {
  const c = (taskCategories as Record<string, { label: string; icon: string }>)[category];
  return c ? `${c.icon} ${c.label}` : category;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Срок на карточке: «Сегодня 14:00», «Завтра», «12 ноя», «Просрочено · 5 ноя».
 * Выполненная — без «просрочено». Дата задачи — календарная (ГГГГ-ММ-ДД).
 */
export function cardDue(
  t: { date: string; time: string | null; completed: boolean },
  now: Date = new Date(),
): { label: string; overdue: boolean } {
  const day = t.date.slice(0, 10);
  const today = formatDate(now);
  const tomorrow = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const yesterday = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const [y, m, d] = day.split('-').map(Number);
  const named =
    day === today ? 'Сегодня' : day === tomorrow ? 'Завтра' : day === yesterday ? 'Вчера' : `${d} ${MONTHS[(m || 1) - 1]}${y !== now.getFullYear() ? ` ${y}` : ''}`;
  const withTime = t.time ? `${named} ${t.time}` : named;
  const overdue = !t.completed && day < today;
  return { label: overdue ? `Просрочено · ${withTime}` : withTime, overdue };
}

/** Индекс колонки по прокрутке доски (ближайшая к левому краю). */
export function columnIndexAt(offsetX: number, step: number): number {
  if (step <= 0) return 0;
  return Math.max(0, Math.min(KANBAN_COLUMNS.length - 1, Math.round(offsetX / step)));
}
