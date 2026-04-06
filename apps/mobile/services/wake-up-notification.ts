import * as Notifications from 'expo-notifications';
import { createMMKV } from 'react-native-mmkv';
import { getDailyQuote } from '@/utils/quotes';

const storage = createMMKV({ id: 'wakeup-storage' });

const WAKEUP_IDENTIFIER = 'wakeup';

export async function scheduleWakeUpNotification(
  wakeUpTime: string,
): Promise<void> {
  const parts = wakeUpTime.split(':');
  if (parts.length !== 2) return;

  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return;
  }

  // Cancel existing wake-up notification
  await cancelWakeUpNotification();

  const quote = getDailyQuote(new Date());

  await Notifications.scheduleNotificationAsync({
    identifier: WAKEUP_IDENTIFIER,
    content: {
      title: 'Доброе утро! \u2600\uFE0F',
      body: quote.text,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });

  storage.set('wakeUpTime', wakeUpTime);
}

export async function cancelWakeUpNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(WAKEUP_IDENTIFIER);
}
