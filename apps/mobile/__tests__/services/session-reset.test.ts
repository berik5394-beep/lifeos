jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(async () => {}) }));
import * as Notifications from 'expo-notifications';
import { resetUserSession } from '@/services/session-reset';
import { useTaskStore } from '@/stores/task-store';
import { useChatStore } from '@/stores/chat-store';
import { useReplyBubbleStore } from '@/hooks/use-reply-bubble';
import { storage } from '@/services/storage';

/** Аудит 2026-11-09: после выхода — ни данных, ни облачка, ни будильников прошлого аккаунта. */
describe('resetUserSession', () => {
  it('сторы пустые, будильники сняты, тумблеры аккаунта стёрты', async () => {
    useTaskStore.setState({ tasks: [{ id: 't', title: 'чужая' }] as never });
    useChatStore.setState({ messages: [{ id: 'm', role: 'assistant', content: 'Записать расход 25 000 ₸?' }] as never });
    storage.setBoolean('task_reminders', false);
    await resetUserSession();
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useReplyBubbleStore.getState()).toEqual(useReplyBubbleStore.getInitialState());
    expect(typeof useTaskStore.getState().fetchTasks).toBe('function');
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(storage.getBoolean('task_reminders')).toBeUndefined();
  });
});
