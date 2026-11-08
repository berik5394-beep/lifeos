/**
 * Пачка задач, созданная В ОБХОД /tasks (фото, расписание с фото, диктовка).
 * Раньше такие задачи шли мимо проверки наложения, перегруза дня и привязки к
 * цели, а диктовка — ещё и мимо памяти мозга (аудит проводки 2026-11-08).
 */
import { linkTaskToGoalInBackground } from './task-goal-link.js';
import { screenConflictText } from './schedule-conflict/index.js';
import { proposeReschedule } from './reschedule.js';
import { addCivilDays } from '../lib/tz.js';

export interface BulkTask {
  id: string;
  title: string;
  date: Date;
  time: string | null;
}

const MAX_LINKS = 10;
/** Наложение проверяем у первых N задач со временем (большое расписание — без лавины запросов). */
const MAX_CONFLICT_CHECKS = 20;

/**
 * Привязка к целям (фоном, до 10), наложение задач со временем (первые 2
 * предупреждения) и перегруз дня (первое предложение). Best-effort, не бросает.
 */
export async function afterBulkTasksCreated(
  userId: string,
  tasks: BulkTask[],
  opts: { checks?: boolean } = {},
): Promise<{ conflictWarning?: string; proposal?: { text: string; staged: boolean } }> {
  for (const t of tasks.slice(0, MAX_LINKS)) linkTaskToGoalInBackground(userId, t.id, t.title);
  // checks:false — вызывающий НЕ покажет предупреждения (диктовка): не ставим
  // невидимое предложение сдвига (иначе случайное «да» подтвердило бы его вслепую).
  if (opts.checks === false) return {};
  try {
    const warnings: string[] = [];
    for (const t of tasks.filter((x) => x.time).slice(0, MAX_CONFLICT_CHECKS)) {
      if (warnings.length >= 2) break;
      const w = await screenConflictText(userId, t.date, { kind: 'task', title: t.title, start: t.time }, { taskId: t.id });
      if (w) warnings.push(`«${t.title}»: ${w.charAt(0).toLowerCase()}${w.slice(1)}`);
    }
    let proposal: { text: string; staged: boolean } | undefined;
    const days = [...new Set(tasks.map((t) => t.date.toISOString().slice(0, 10)))].slice(0, 3);
    for (const d of days) {
      const p = await proposeReschedule(userId, d, null, new Date(), { fromCard: true });
      if (p) {
        proposal = { text: p.text, staged: p.staged };
        break;
      }
    }
    return { ...(warnings.length ? { conflictWarning: warnings.join(' ') } : {}), ...(proposal ? { proposal } : {}) };
  } catch (err) {
    console.warn('[bulk-tasks] checks failed:', err instanceof Error ? err.message : err);
    return {};
  }
}

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^(пн|понед|mon)/i, 1],
  [/^(вт|вторн|tue)/i, 2],
  [/^(ср|сред|wed)/i, 3],
  [/^(чт|четв|thu)/i, 4],
  [/^(пт|пятн|fri)/i, 5],
  [/^(сб|субб|sat)/i, 6],
  [/^(вс|воскр|sun)/i, 0],
];

/**
 * «Понедельник» → ближайший понедельник с baseDay (включительно). Пусто /
 * непонятно → baseDay. Раньше day игнорировался: расписание недели ложилось
 * на один день.
 */
export function dayForWeekday(dayName: string, baseDay: string): string {
  const t = dayName.trim();
  if (!t) return baseDay;
  const wd = WEEKDAYS.find(([re]) => re.test(t))?.[1];
  if (wd === undefined) return baseDay;
  const cur = new Date(`${baseDay}T00:00:00Z`).getUTCDay();
  return addCivilDays(baseDay, (wd - cur + 7) % 7);
}

/** «9:00–10:30» / «9.00» → «09:00»; нет времени → null. */
export function startTimeOf(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[:.](\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
