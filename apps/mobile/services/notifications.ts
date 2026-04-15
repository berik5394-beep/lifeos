import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getDailyQuote, getRandomQuote } from '@/utils/quotes';
import { scheduleAlarmNotification } from '@/services/alarm-notifications';

// ---------------------------------------------------------------------------
// Notification handler — global config for foreground display
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Notification identifier prefixes (for deterministic cancel / reschedule)
// ---------------------------------------------------------------------------
const PREFIX_MORNING = 'morning-briefing';
const PREFIX_EVENING = 'evening-review';
const PREFIX_WEEKLY = 'weekly-report';
const PREFIX_TASK = 'task-reminder-';
const PREFIX_EVENT_60 = 'event-60-';
const PREFIX_EVENT_30 = 'event-30-';
const PREFIX_STREAK = 'streak-reminder';
const PREFIX_BUDGET = 'budget-warning';

// ---------------------------------------------------------------------------
// Permission request
// ---------------------------------------------------------------------------
export async function requestPermissions(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push-уведомления работают только на физическом устройстве');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Разрешение на уведомления не получено');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'LifeOS',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366F1',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
}

/** @deprecated Use `requestPermissions` — kept for backward-compat */
export const registerForPushNotifications = requestPermissions;

// ---------------------------------------------------------------------------
// Cancel helpers
// ---------------------------------------------------------------------------
export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Cancel all scheduled notifications whose identifier starts with `prefix`.
 */
async function cancelByPrefix(prefix: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matching = scheduled.filter(
    (n) => n.identifier.startsWith(prefix),
  );
  await Promise.all(
    matching.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

// ---------------------------------------------------------------------------
// Task reminders  (30 min soft push + alarm at exact time)
// ---------------------------------------------------------------------------
export async function scheduleTaskReminder(
  taskId: string,
  title: string,
  taskDate: Date,
  taskTime: string,
): Promise<string | null> {
  const [hours, minutes] = taskTime.split(':').map(Number);
  const triggerDate = new Date(taskDate);
  triggerDate.setHours(hours, minutes, 0, 0);

  // Soft reminder 30 min before
  const reminderDate = new Date(triggerDate.getTime() - 30 * 60 * 1000);
  let softId: string | null = null;

  if (reminderDate.getTime() > Date.now()) {
    softId = await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX_TASK}${taskId}`,
      content: {
        title: 'Напоминание',
        body: `Через 30 минут: ${title}`,
        sound: true,
        data: { type: 'task', taskId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
      },
    });
  }

  // Alarm at exact task time
  if (triggerDate.getTime() > Date.now()) {
    await scheduleAlarmNotification({
      title: `Время: ${title}`,
      body: `Задача "${title}" — начинай прямо сейчас!`,
      triggerDate,
    });
  }

  return softId;
}

/**
 * Cancel a previously scheduled task reminder by task id.
 */
export async function cancelTaskReminder(taskId: string): Promise<void> {
  await cancelByPrefix(`${PREFIX_TASK}${taskId}`);
}

// ---------------------------------------------------------------------------
// Event reminders (1 hour + 30 min before)
// ---------------------------------------------------------------------------
export async function scheduleEventReminder(
  eventId: string,
  title: string,
  eventDate: Date,
  startTime: string,
): Promise<void> {
  const [hours, minutes] = startTime.split(':').map(Number);
  const triggerDate = new Date(eventDate);
  triggerDate.setHours(hours, minutes, 0, 0);

  const oneHourBefore = new Date(triggerDate.getTime() - 60 * 60 * 1000);
  const thirtyMinBefore = new Date(triggerDate.getTime() - 30 * 60 * 1000);

  if (oneHourBefore.getTime() > Date.now()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX_EVENT_60}${eventId}`,
      content: {
        title: 'Встреча через 1 час',
        body: title,
        sound: true,
        data: { type: 'event', eventId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: oneHourBefore,
      },
    });
  }

  if (thirtyMinBefore.getTime() > Date.now()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX_EVENT_30}${eventId}`,
      content: {
        title: 'Встреча через 30 минут',
        body: title,
        sound: true,
        data: { type: 'event', eventId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: thirtyMinBefore,
      },
    });
  }
}

/**
 * Cancel all scheduled event reminders for a given event.
 */
export async function cancelEventReminder(eventId: string): Promise<void> {
  await cancelByPrefix(`${PREFIX_EVENT_60}${eventId}`);
  await cancelByPrefix(`${PREFIX_EVENT_30}${eventId}`);
}

// ---------------------------------------------------------------------------
// Morning briefing (daily recurring at user's wake time)
// ---------------------------------------------------------------------------
export async function scheduleMorningBriefing(
  wakeUpTime: string = '08:00',
): Promise<string> {
  // Cancel previous morning notification so we don't stack duplicates
  await cancelByPrefix(PREFIX_MORNING);

  const [hour, minute] = wakeUpTime.split(':').map(Number);
  const quote = getDailyQuote(new Date());

  const id = await Notifications.scheduleNotificationAsync({
    identifier: PREFIX_MORNING,
    content: {
      title: 'Доброе утро! ☀️',
      body: `Новый день — новые возможности!\n💡 ${quote.text} — ${quote.author}`,
      sound: true,
      data: { type: 'morning_briefing' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });

  return id;
}

/** @deprecated Use `scheduleMorningBriefing` */
export async function scheduleMorningReminder(
  tasks: { title: string }[],
): Promise<string> {
  const quote = getDailyQuote(new Date());
  const taskCount = tasks.length;
  const taskText =
    taskCount === 0
      ? 'Сегодня нет запланированных задач.'
      : `Сегодня ${taskCount} ${getTaskWord(taskCount)}.`;
  const body = `${taskText}\n\n💡 ${quote.text} — ${quote.author}`;

  const id = await Notifications.scheduleNotificationAsync({
    identifier: PREFIX_MORNING,
    content: {
      title: 'Доброе утро! ☀️',
      body,
      sound: true,
      data: { type: 'morning_briefing' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Evening review (daily recurring)
// ---------------------------------------------------------------------------
export async function scheduleEveningReview(
  time: string = '21:00',
): Promise<string> {
  await cancelByPrefix(PREFIX_EVENING);

  const [hour, minute] = time.split(':').map(Number);

  const id = await Notifications.scheduleNotificationAsync({
    identifier: PREFIX_EVENING,
    content: {
      title: 'Вечерний обзор 🌙',
      body: 'Время подвести итоги дня. Откройте приложение!',
      sound: true,
      data: { type: 'evening_review' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Weekly report (Sunday 20:00)
// ---------------------------------------------------------------------------
export async function scheduleWeeklyReport(): Promise<string> {
  await cancelByPrefix(PREFIX_WEEKLY);

  const id = await Notifications.scheduleNotificationAsync({
    identifier: PREFIX_WEEKLY,
    content: {
      title: 'Итоги недели 📊',
      body: 'Посмотрите вашу статистику за неделю и спланируйте следующую.',
      sound: true,
      data: { type: 'weekly_report' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1,
      hour: 20,
      minute: 0,
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Streak reminder — 20:00 if habits not done today
// ---------------------------------------------------------------------------
export async function scheduleStreakReminder(
  streakDays: number,
): Promise<string> {
  await cancelByPrefix(PREFIX_STREAK);

  const now = new Date();
  const triggerDate = new Date(now);
  triggerDate.setHours(20, 0, 0, 0);

  // If it's already past 20:00 today, schedule for tomorrow
  if (triggerDate.getTime() <= now.getTime()) {
    triggerDate.setDate(triggerDate.getDate() + 1);
  }

  const body =
    streakDays > 0
      ? `Ты на серии ${streakDays} ${getDayWord(streakDays)}! Не потеряй её — открой привычки.`
      : 'Не забудь отметить привычки сегодня!';

  const id = await Notifications.scheduleNotificationAsync({
    identifier: PREFIX_STREAK,
    content: {
      title: 'Привычки 🔥',
      body,
      sound: true,
      data: { type: 'streak_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });

  return id;
}

// ---------------------------------------------------------------------------
// Streak celebration (instant)
// ---------------------------------------------------------------------------
export async function scheduleStreakNotification(
  habitName: string,
  streak: number,
): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Серия! 🔥',
      body: `Вы на серии ${streak} ${getDayWord(streak)} в привычке "${habitName}"!`,
      sound: true,
      data: { type: 'streak_celebration' },
    },
    trigger: null,
  });

  return id;
}

// ---------------------------------------------------------------------------
// Budget warning (instant)
// ---------------------------------------------------------------------------
export async function sendBudgetWarning(
  category: string,
  spent: number,
  limit: number,
): Promise<string> {
  const pct = Math.round((spent / limit) * 100);
  const isOver = spent >= limit;

  const id = await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX_BUDGET}-${category}`,
    content: {
      title: isOver ? 'Бюджет превышен! ⚠️' : 'Приближение к лимиту 💰',
      body: isOver
        ? `Категория "${category}": потрачено ${pct}% лимита. Пора остановиться!`
        : `Категория "${category}": ${pct}% бюджета израсходовано. Будьте осторожны.`,
      sound: true,
      data: { type: 'budget_warning', category },
    },
    trigger: null,
  });

  return id;
}

// ---------------------------------------------------------------------------
// Motivation quote (instant)
// ---------------------------------------------------------------------------
export async function sendMotivationQuote(): Promise<string> {
  const quote = getRandomQuote();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Мотивация 💪',
      body: `${quote.text}\n— ${quote.author}`,
      sound: true,
      data: { type: 'motivation' },
    },
    trigger: null,
  });

  return id;
}

// ---------------------------------------------------------------------------
// Reschedule ALL task reminders from an array of tasks
// ---------------------------------------------------------------------------
interface TaskForReminder {
  id: string;
  title: string;
  date: string;
  time: string | null;
  completed: boolean;
}

export async function rescheduleAllTaskReminders(
  tasks: TaskForReminder[],
): Promise<void> {
  // Cancel all existing task reminders
  await cancelByPrefix(PREFIX_TASK);

  // Schedule reminders only for future, uncompleted tasks with a time
  const now = Date.now();
  for (const task of tasks) {
    if (task.completed || !task.time) continue;

    const taskDate = new Date(task.date);
    const [h, m] = task.time.split(':').map(Number);
    taskDate.setHours(h, m, 0, 0);

    if (taskDate.getTime() > now) {
      await scheduleTaskReminder(task.id, task.title, new Date(task.date), task.time);
    }
  }
}

// ---------------------------------------------------------------------------
// Reschedule ALL event reminders from an array of events
// ---------------------------------------------------------------------------
interface EventForReminder {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
}

export async function rescheduleAllEventReminders(
  events: EventForReminder[],
): Promise<void> {
  // Cancel all existing event reminders
  await cancelByPrefix(PREFIX_EVENT_60);
  await cancelByPrefix(PREFIX_EVENT_30);

  const now = Date.now();
  for (const event of events) {
    if (!event.startTime) continue;

    const eventDate = new Date(event.date);
    const [h, m] = event.startTime.split(':').map(Number);
    eventDate.setHours(h, m, 0, 0);

    if (eventDate.getTime() > now) {
      await scheduleEventReminder(event.id, event.title, new Date(event.date), event.startTime);
    }
  }
}

// ---------------------------------------------------------------------------
// Russian pluralization helpers
// ---------------------------------------------------------------------------
function getTaskWord(count: number): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;

  if (lastTwo >= 11 && lastTwo <= 19) return 'задач';
  if (lastOne === 1) return 'задача';
  if (lastOne >= 2 && lastOne <= 4) return 'задачи';
  return 'задач';
}

function getDayWord(count: number): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;

  if (lastTwo >= 11 && lastTwo <= 19) return 'дней';
  if (lastOne === 1) return 'день';
  if (lastOne >= 2 && lastOne <= 4) return 'дня';
  return 'дней';
}
