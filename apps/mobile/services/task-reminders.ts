/**
 * Напоминания задач: мягкое за 30 минут + будильник во время задачи.
 *
 * Раньше:
 *  - при КАЖДОМ изменении списка снимались ВСЕ напоминания задач и ставились
 *    заново только по задачам из стора — а стор держит выборку (неделя/месяц),
 *    так что напоминания задач вне выборки (следующий месяц) стирались;
 *  - будильник ставился без постоянного id — каждое изменение добавляло дубль,
 *    и снять его было нельзя (звенел и у закрытых задач);
 *  - «сегодня» и день задачи считались по UTC (ночью — вчерашний день).
 */
import * as Notifications from 'expo-notifications';
import { scheduleAlarmNotification } from '@/services/alarm-notifications';

export const TASK_REMINDER_PREFIX = 'task-reminder-';
export const TASK_ALARM_PREFIX = 'task-alarm-';
const SOFT_MINUTES = 30;

export interface ReminderTask {
  id: string;
  title: string;
  date: string;
  time: string | null;
  completed: boolean;
}

export interface PlannedReminder {
  identifier: string;
  kind: 'soft' | 'alarm';
  title: string;
  taskId: string;
  at: Date;
}

/** Момент задачи по местному времени: сервер шлёт «2026-11-06» или ISO с полуночью UTC. */
export function localTaskTime(date: string, time: string): Date | null {
  const d = date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
}

/** Что должно стоять для этих задач (только будущее, только незакрытые со временем). */
export function planTaskReminders(tasks: ReminderTask[], now: number): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const task of tasks) {
    if (task.completed || !task.time) continue;
    const at = localTaskTime(task.date, task.time);
    if (!at) continue;
    const soft = new Date(at.getTime() - SOFT_MINUTES * 60_000);
    if (soft.getTime() > now) {
      out.push({ identifier: `${TASK_REMINDER_PREFIX}${task.id}`, kind: 'soft', title: task.title, taskId: task.id, at: soft });
    }
    if (at.getTime() > now) {
      out.push({ identifier: `${TASK_ALARM_PREFIX}${task.id}`, kind: 'alarm', title: task.title, taskId: task.id, at });
    }
  }
  return out;
}

type Scheduled = { identifier: string; content: { title?: string | null; data?: Record<string, unknown> | null } };

/**
 * Какие из стоящих уведомлений снять перед пересборкой: напоминания задач из
 * списка (их поставим заново) и старые будильники задач без постоянного id.
 * Напоминания задач ВНЕ списка не трогаем — их просто нет в текущей выборке.
 */
export function remindersToCancel(scheduled: Scheduled[], taskIds: Set<string>): string[] {
  return scheduled
    .filter((n) => {
      const id = n.identifier;
      if (id.startsWith(TASK_REMINDER_PREFIX)) return taskIds.has(id.slice(TASK_REMINDER_PREFIX.length));
      if (id.startsWith(TASK_ALARM_PREFIX)) return taskIds.has(id.slice(TASK_ALARM_PREFIX.length));
      const legacyTaskAlarm = n.content.data?.type === 'alarm' && (n.content.title ?? '').startsWith('Время: ');
      return legacyTaskAlarm;
    })
    .map((n) => n.identifier);
}

/**
 * soft=false — мягкое «через 30 минут» шлёт сервер пушем (есть токен), здесь
 * только будильник во время задачи; иначе приходило два одинаковых напоминания.
 */
export async function syncTaskReminders(
  tasks: ReminderTask[],
  now: number = Date.now(),
  opts: { soft?: boolean } = {},
): Promise<void> {
  const soft = opts.soft ?? true;
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()) as unknown as Scheduled[];
  const cancel = remindersToCancel(scheduled, new Set(tasks.map((t) => t.id)));
  if (!soft) {
    for (const n of scheduled) if (n.identifier.startsWith(TASK_REMINDER_PREFIX) && !cancel.includes(n.identifier)) cancel.push(n.identifier);
  }
  await Promise.all(cancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  for (const r of planTaskReminders(tasks, now)) {
    if (r.kind === 'soft' && !soft) continue;
    if (r.kind === 'soft') {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: { title: 'Напоминание', body: `Через ${SOFT_MINUTES} минут: ${r.title}`, sound: true, interruptionLevel: 'timeSensitive', data: { type: 'task', taskId: r.taskId } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    } else {
      await scheduleAlarmNotification({
        id: r.identifier,
        title: `Время: ${r.title}`,
        body: `Задача "${r.title}" — начинай прямо сейчас!`,
        triggerDate: r.at,
      });
    }
  }
}

/** Задачу удалили — снять её напоминание и будильник. */
export async function cancelTaskReminders(taskId: string): Promise<void> {
  await Promise.all(
    [`${TASK_REMINDER_PREFIX}${taskId}`, `${TASK_ALARM_PREFIX}${taskId}`].map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
    ),
  );
}
