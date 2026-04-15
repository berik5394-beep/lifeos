import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Android: create a high-priority "alarm" channel with custom sound
async function ensureAlarmChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('alarm', {
    name: 'Будильник LifeOS',
    description: 'Срочные напоминания о задачах и встречах (со звуком будильника)',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'alarm.wav',
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    enableVibrate: true,
    enableLights: true,
    lightColor: '#EF4444',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });

  // Regular channel for normal notifications
  await Notifications.setNotificationChannelAsync('default', {
    name: 'LifeOS',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366F1',
  });
}

// Initialize alarm channels on app start
ensureAlarmChannel().catch(() => { /* ignore on iOS */ });

/**
 * Schedule an ALARM-style notification for a task/event.
 * This makes the phone ring loudly like an alarm clock.
 *
 * On iOS: uses critical alert sound + high priority
 * On Android: uses MAX importance channel + custom alarm sound + full-screen intent
 */
export async function scheduleAlarmNotification(params: {
  title: string;
  body: string;
  triggerDate: Date;
  id?: string;
}): Promise<string> {
  const { title, body, triggerDate, id } = params;

  // Don't schedule in the past
  if (triggerDate.getTime() <= Date.now()) {
    return '';
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title,
      body,
      sound: Platform.OS === 'android' ? 'alarm.wav' : true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 500, 200, 500, 200, 500, 200, 500],
      ...(Platform.OS === 'android' && {
        channelId: 'alarm',
      }),
      // iOS: make it persistent (shows as banner that stays)
      sticky: true,
      // Data for handling the notification tap
      data: { type: 'alarm', title },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
      channelId: Platform.OS === 'android' ? 'alarm' : undefined,
    },
  });

  return notificationId;
}

/**
 * Schedule alarm for a task at a specific time.
 * Rings like an alarm clock at the task's scheduled time.
 */
export async function scheduleTaskAlarm(params: {
  taskId: string;
  taskTitle: string;
  taskDate: Date;
  taskTime: string; // "HH:MM"
  minutesBefore?: number; // default 0 = exact time
}): Promise<string> {
  const { taskId, taskTitle, taskDate, taskTime, minutesBefore = 0 } = params;

  const [hours, minutes] = taskTime.split(':').map(Number);
  const triggerDate = new Date(taskDate);
  triggerDate.setHours(hours, minutes, 0, 0);

  // Subtract minutes before
  if (minutesBefore > 0) {
    triggerDate.setTime(triggerDate.getTime() - minutesBefore * 60 * 1000);
  }

  return scheduleAlarmNotification({
    title: minutesBefore > 0
      ? `Через ${minutesBefore} мин: ${taskTitle}`
      : `Сейчас: ${taskTitle}`,
    body: minutesBefore > 0
      ? `Не забудь! Задача "${taskTitle}" скоро начнётся`
      : `Время выполнить задачу "${taskTitle}"!`,
    triggerDate,
    id: `task-alarm-${taskId}`,
  });
}

/**
 * Schedule alarm for a calendar event/meeting.
 * More aggressive — rings like a full alarm.
 */
export async function scheduleEventAlarm(params: {
  eventId: string;
  eventTitle: string;
  eventDate: Date;
  startTime: string; // "HH:MM"
  minutesBefore?: number; // default 15
  location?: string;
}): Promise<string> {
  const { eventId, eventTitle, eventDate, startTime, minutesBefore = 15, location } = params;

  const [hours, minutes] = startTime.split(':').map(Number);
  const triggerDate = new Date(eventDate);
  triggerDate.setHours(hours, minutes, 0, 0);
  triggerDate.setTime(triggerDate.getTime() - minutesBefore * 60 * 1000);

  const locationText = location ? ` (${location})` : '';

  return scheduleAlarmNotification({
    title: `Встреча через ${minutesBefore} мин!`,
    body: `${eventTitle}${locationText}`,
    triggerDate,
    id: `event-alarm-${eventId}`,
  });
}

/**
 * Schedule alarm for a forgotten/overdue task.
 * If a task is past its time and not completed, ring aggressively.
 */
export async function scheduleOverdueAlarm(params: {
  taskId: string;
  taskTitle: string;
}): Promise<string> {
  const { taskId, taskTitle } = params;

  // Ring immediately
  const triggerDate = new Date(Date.now() + 2000); // 2 sec from now

  return scheduleAlarmNotification({
    title: 'Задача просрочена!',
    body: `"${taskTitle}" — ты забыл выполнить эту задачу!`,
    triggerDate,
    id: `overdue-alarm-${taskId}`,
  });
}

/**
 * Cancel a specific alarm notification.
 */
export async function cancelAlarm(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Notification may have already fired
  }
}

/**
 * Cancel all alarm notifications for a task.
 */
export async function cancelTaskAlarms(taskId: string): Promise<void> {
  await cancelAlarm(`task-alarm-${taskId}`);
}

/**
 * Cancel all alarm notifications for an event.
 */
export async function cancelEventAlarms(eventId: string): Promise<void> {
  await cancelAlarm(`event-alarm-${eventId}`);
}
