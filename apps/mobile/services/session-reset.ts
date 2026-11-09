import * as Notifications from 'expo-notifications';
import { storage } from '@/services/storage';
import type { StoreApi, UseBoundStore } from 'zustand';
// Статически: этот модуль сам грузится лениво из auth-store (нет цикла при старте).
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { useGoalStore } from '@/stores/goal-store';
import { useFinanceStore } from '@/stores/finance-store';
import { useBudgetStore } from '@/stores/budget-store';
import { useDebtStore } from '@/stores/debt-store';
import { useEventStore } from '@/stores/event-store';
import { useJournalStore } from '@/stores/journal-store';
import { useChatStore } from '@/stores/chat-store';
import { useFocusStore } from '@/stores/focus-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import { useIntegrationStore } from '@/stores/integration-store';
import { useSubscriptionStore } from '@/stores/subscription-store';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { useSharedSpaceStore } from '@/stores/shared-space-store';
import { useTagStore } from '@/stores/tag-store';
import { useRoomStore } from '@/stores/room-store';
import { useDealStore } from '@/stores/deal-store';
import { useReplyBubbleStore } from '@/hooks/use-reply-bubble';

/**
 * Выход из аккаунта (аудит 2026-11-09): раньше сбрасывались только комната и
 * сделки — следующий человек на том же телефоне видел чат, задачи, дневник,
 * финансы и облачко «Записать расход?» прошлого, а будильники задач прошлого
 * аккаунта продолжали звенеть.
 */
type AnyStore = UseBoundStore<StoreApi<object>>;

/** Ключи телефона, принадлежащие аккаунту (настройки подтянутся с сервера при входе). */
export const ACCOUNT_LOCAL_KEYS = ['morning_reminder', 'evening_review', 'task_reminders', 'subscription_tier'];

function resetToInitial(store: AnyStore): void {
  store.setState(store.getInitialState(), true);
}

export async function resetUserSession(): Promise<void> {
  // Все локальные напоминания/будильники — прошлого аккаунта.
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  for (const k of ACCOUNT_LOCAL_KEYS) storage.remove(k);

  const stores = [
    useTaskStore, useHabitStore, useGoalStore, useFinanceStore, useBudgetStore, useDebtStore,
    useEventStore, useJournalStore, useChatStore, useFocusStore, useRobotReactionStore,
    useIntegrationStore, useSubscriptionStore, useRoomToolStore, useSharedSpaceStore, useTagStore,
    useReplyBubbleStore,
  ];
  for (const s of stores) resetToInitial(s as unknown as AnyStore);
  useRoomStore.getState().reset();
  useDealStore.getState().reset();
}
