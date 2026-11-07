import * as Notifications from 'expo-notifications';
import { syncTaskReminders, TASK_REMINDER_PREFIX } from '@/services/task-reminders';

/**
 * Есть пуш-токен на сервере → «через 30 минут» шлёт сервер. Локально тогда
 * только будильник во время задачи, иначе одно напоминание приходило дважды.
 */
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('@/services/alarm-notifications', () => ({ scheduleAlarmNotification: jest.fn(async () => 'alarm') }));

const N = Notifications as jest.Mocked<typeof Notifications>;
const now = new Date(2026, 10, 6, 9, 0).getTime();
const task = { id: 't1', title: 'Отчёт', date: '2026-11-06', time: '11:00', completed: false };

beforeEach(() => jest.clearAllMocks());

it('без серверных пушей — мягкое напоминание ставится', async () => {
  N.getAllScheduledNotificationsAsync.mockResolvedValueOnce([] as never);
  await syncTaskReminders([task], now);
  const ids = N.scheduleNotificationAsync.mock.calls.map((c) => (c[0] as { identifier: string }).identifier);
  expect(ids).toContain(`${TASK_REMINDER_PREFIX}t1`);
});

it('с серверными пушами — мягкое не ставится, старое снимается', async () => {
  N.getAllScheduledNotificationsAsync.mockResolvedValueOnce([{ identifier: `${TASK_REMINDER_PREFIX}t1` }] as never);
  await syncTaskReminders([task], now, { soft: false });
  expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`${TASK_REMINDER_PREFIX}t1`);
});
