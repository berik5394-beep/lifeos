import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getDailyQuote, getRandomQuote } from '@/utils/quotes';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
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

export async function scheduleMorningReminder(
  tasks: { title: string }[]
): Promise<string> {
  const quote = getDailyQuote(new Date());
  const taskCount = tasks.length;
  const taskText =
    taskCount === 0
      ? 'Сегодня нет запланированных задач.'
      : `Сегодня ${taskCount} ${getTaskWord(taskCount)}.`;
  const body = `${taskText}\n\n💡 ${quote.text} — ${quote.author}`;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Доброе утро! ☀️',
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
    },
  });

  return id;
}

export async function scheduleTaskReminder(
  taskTitle: string,
  taskDate: Date,
  taskTime: string
): Promise<string> {
  const [hours, minutes] = taskTime.split(':').map(Number);
  const triggerDate = new Date(taskDate);
  triggerDate.setHours(hours, minutes, 0, 0);

  const reminderDate = new Date(triggerDate.getTime() - 30 * 60 * 1000);

  if (reminderDate.getTime() <= Date.now()) {
    return '';
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Напоминание',
      body: `Через 30 минут: ${taskTitle}`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  });

  return id;
}

export async function scheduleEveningReview(
  uncompletedCount: number
): Promise<string> {
  const body =
    uncompletedCount === 0
      ? 'Все задачи выполнены! Отличная работа! 🎉'
      : `${uncompletedCount} ${getTaskWord(uncompletedCount)} не выполнено. Проверьте свой список.`;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Вечерний обзор',
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 21,
      minute: 0,
    },
  });

  return id;
}

export async function scheduleWeeklyReport(): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Итоги недели 📊',
      body: 'Посмотрите вашу статистику за неделю',
      sound: true,
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

export async function scheduleStreakNotification(
  habitName: string,
  streak: number
): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Серия! 🔥',
      body: `Вы на серии ${streak} ${getDayWord(streak)} в привычке "${habitName}"!`,
      sound: true,
    },
    trigger: null,
  });

  return id;
}

export async function sendMotivationQuote(): Promise<string> {
  const quote = getRandomQuote();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Мотивация 💪',
      body: `${quote.text}\n— ${quote.author}`,
      sound: true,
    },
    trigger: null,
  });

  return id;
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

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
