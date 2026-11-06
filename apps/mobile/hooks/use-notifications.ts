import { useEffect, useRef, useCallback, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';
import {
  requestPermissions,
  scheduleMorningBriefing,
  scheduleEveningReview,
  scheduleWeeklyReport,
  scheduleStreakReminder,
  rescheduleAllEventReminders,
  setBadgeCount,
} from '@/services/notifications';
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';
import { api } from '@/services/api';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { syncTaskReminders } from '@/services/task-reminders';
import { formatDate } from '@/utils/dates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventForReminder {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
}

interface BriefingResponse {
  tasks: { id: string; title: string; date: string; time: string | null; completed: boolean }[];
  events: EventForReminder[];
  habitsProgress: string;
  streak: number;
  quote: { text: string; author: string };
  budgetStatus: {
    spent: number;
    limit: number;
    remaining: number;
  };
}

interface UseNotificationsResult {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  briefing: BriefingResponse | null;
  fetchBriefing: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useNotifications(): UseNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  const tasks = useTaskStore((s) => s.tasks);
  const habits = useHabitStore((s) => s.habits);
  const logs = useHabitStore((s) => s.logs);
  const user = useAuthStore((s) => s.user);

  const navigation = useNavigation();

  // -------------------------------------------------------------------------
  // Fetch server briefing data
  // -------------------------------------------------------------------------
  const fetchBriefing = useCallback(async () => {
    // Без токена сервер всегда отвечал 401 — утренняя сводка не приходила.
    const authToken = useAuthStore.getState().token;
    if (!authToken) return;
    try {
      const data = await api.get<BriefingResponse>('/notifications/briefing', authToken);
      setBriefing(data);
    } catch {
      // Server unavailable — not critical for local notifications
    }
  }, []);

  // -------------------------------------------------------------------------
  // Initialization: permissions + recurring schedules
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function init() {
      const token = await requestPermissions().catch(() => null);
      if (mounted) setExpoPushToken(token);

      // Регистрируем push-токен на сервере — primary канал проактивных
      // уведомлений (app-first). Сервер шлёт сюда напоминания через
      // Expo Push, даже когда приложение закрыто.
      if (token) {
        const authToken = useAuthStore.getState().token;
        if (authToken) {
          api
            .post('/notifications/register-token', { token }, authToken)
            .catch(() => {
              /* не критично — повторим при следующем запуске */
            });
        }
      }

      // Read user's wake-up time from local storage (default 08:00)
      const wakeUpTime = storage.getString('wakeUpTime') ?? '08:00';

      // Schedule recurring notifications (these are idempotent — cancel + reschedule)
      await scheduleMorningBriefing(wakeUpTime).catch(() => {});
      await scheduleEveningReview('21:00').catch(() => {});
      await scheduleWeeklyReport().catch(() => {});
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Notification listeners (foreground + tap response)
  // -------------------------------------------------------------------------
  useEffect(() => {
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (receivedNotification) => {
        setNotification(receivedNotification);
      },
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        setNotification(response.notification);

        // Navigate based on notification data.type
        const data = response.notification.request.content.data as
          | Record<string, string>
          | undefined;

        if (!data?.type) return;
        const openRoomTool = (tool: string) => {
          navigation.navigate('Home' as never);
          useRoomToolStore.getState().openTool(tool);
        };

        switch (data.type) {
          // Робот-эпик, Часть 5: всё живёт в комнате — робот достаёт нужный инструмент.
          case 'task':
            openRoomTool('tasks');
            break;
          case 'event':
            openRoomTool('calendar');
            break;
          case 'morning_briefing':
          case 'evening_review':
          case 'weekly_report':
            openRoomTool('today');
            break;
          case 'streak_reminder':
          case 'streak_celebration':
            openRoomTool('habits');
            break;
          case 'budget_warning':
            openRoomTool('finance');
            break;
          case 'motivation':
            // No special navigation
            break;
        }
      },
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [navigation]);

  // -------------------------------------------------------------------------
  // Reschedule task reminders when tasks change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (tasks.length === 0) return;

    // «Сегодня» — по местному времени (toISOString давал UTC: ночью — вчера).
    const todayStr = formatDate(new Date());
    // Пересобираем напоминания только задач из списка; задачи вне выборки
    // (другой месяц) не трогаем. Закрытые и прошедшие — снимаются.
    syncTaskReminders(tasks).catch(() => {});

    // Update badge count with uncompleted task count for today
    const todayUncompleted = tasks.filter(
      (t) => !t.completed && t.date.slice(0, 10) === todayStr,
    ).length;
    setBadgeCount(todayUncompleted).catch(() => {});
  }, [tasks]);

  // -------------------------------------------------------------------------
  // Reschedule event reminders on briefing data
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!briefing?.events || briefing.events.length === 0) return;
    rescheduleAllEventReminders(briefing.events).catch(() => {});
  }, [briefing]);

  // -------------------------------------------------------------------------
  // Streak reminder — check if today's habits are incomplete
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (habits.length === 0) return;

    const todayStr = formatDate(new Date());
    const todayLogs = logs[todayStr] ?? [];
    const completedCount = todayLogs.filter((l) => l.completed).length;
    const allDone = completedCount >= habits.filter((h) => h.active).length;

    if (!allDone) {
      // Calculate current streak from local storage
      const streakStr = storage.getString('currentStreak');
      const streak = streakStr ? parseInt(streakStr, 10) : 0;
      scheduleStreakReminder(streak).catch(() => {});
    }
  }, [habits, logs]);

  // -------------------------------------------------------------------------
  // Fetch briefing on mount if user is logged in
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (user) {
      fetchBriefing();
    }
  }, [user, fetchBriefing]);

  return { expoPushToken, notification, briefing, fetchBriefing };
}
