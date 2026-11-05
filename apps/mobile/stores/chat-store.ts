import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { confirmPendingVoiceAction, isConfirmable, type PendingActionInfo } from '@/services/voice-followup';
import { normalizeEmotion, type RobotEmotion } from '@/services/robot-emotion';

export interface ChatAction {
  type: string;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
  /** Деньги/необратимое: мозг ждёт подтверждения → под сообщением кнопки «Записать / Отмена». */
  pendingAction?: PendingActionInfo | null;
  /** Эмоция робота на этот ответ (сервер, по фактам хода). */
  emotion?: RobotEmotion;
  createdAt: string;
}

interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

interface ChatResponse {
  message: ChatMessage;
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  sendMessage: (text: string, webSearch?: boolean) => Promise<void>;
  fetchHistory: (offset?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  executeAction: (action: ChatAction) => Promise<void>;
  confirmPendingAction: (messageId: string, confirm: boolean) => Promise<void>;
}

let _msgSeq = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_msgSeq}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  hasMore: true,

  sendMessage: async (text: string, webSearch?: boolean) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const userMessage: ChatMessage = {
      id: uniqueId('user'),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    // Сервер держит ОДИН pending на юзера: любое новое сообщение его
    // подтверждает/отменяет/заменяет. Старые кнопки «Подтвердить» подтвердили
    // бы уже ЧУЖОЕ (новое) предложение → снимаем их со всех сообщений.
    set((state) => ({
      messages: [
        userMessage,
        ...state.messages.map((m) => (m.pendingAction ? { ...m, pendingAction: null } : m)),
      ],
      isLoading: true,
    }));

    try {
      const data = await api.post<{ message: string; actions?: ChatAction[]; pendingAction?: PendingActionInfo | null; emotion?: string }>(
        '/voice/chat',
        { text, webSearch: webSearch ?? false },
        token,
      );

      const assistantMessage: ChatMessage = {
        id: uniqueId('assistant'),
        role: 'assistant',
        content: data.message,
        actions: data.actions,
        // Слот-вопрос «На что потратил?» — без кнопок: юзер отвечает текстом.
        pendingAction: isConfirmable(data.pendingAction) ? data.pendingAction : null,
        emotion: normalizeEmotion(data.emotion),
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [assistantMessage, ...state.messages],
        isLoading: false,
      }));
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: uniqueId('error'),
        role: 'assistant',
        content: 'Произошла ошибка. Попробуйте ещё раз.',
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [errorMessage, ...state.messages],
        isLoading: false,
      }));
    }
  },

  fetchHistory: async (offset?: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const currentOffset = offset ?? get().messages.length;
      const raw = await api.get<ChatMessage[] | ChatHistoryResponse>(
        `/chat/history?limit=20&offset=${currentOffset}`,
        token,
      );

      // Handle both shapes: raw array or { messages, hasMore } wrapper
      const messages: ChatMessage[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as ChatHistoryResponse).messages)
          ? (raw as ChatHistoryResponse).messages
          : [];
      const serverHasMore = !Array.isArray(raw) && typeof (raw as ChatHistoryResponse).hasMore === 'boolean'
        ? (raw as ChatHistoryResponse).hasMore
        : messages.length >= 20;

      set((state) => {
        const reversed = messages.reverse();
        if (offset === 0) {
          return { messages: reversed, hasMore: serverHasMore };
        }
        const existingIds = new Set(state.messages.map(m => m.id));
        const newMessages = reversed.filter(m => !existingIds.has(m.id));
        return { messages: [...state.messages, ...newMessages], hasMore: serverHasMore };
      });
    } catch {
      // Silently fail for history fetch
    }
  },

  clearHistory: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    // Optimistically clear UI immediately for instant feedback
    set({ messages: [], hasMore: false });

    try {
      await api.delete('/chat/history', token);
    } catch (err) {
      console.warn('Failed to clear chat history on server:', err);
      // UI already cleared — user sees empty chat regardless
    }
  },

  confirmPendingAction: async (messageId: string, confirm: boolean) => {
    // Снимаем кнопки СРАЗУ (до ответа сервера) — двойной тап не шлёт второй
    // запрос. При сбое возвращаем, чтобы можно было повторить.
    const target = get().messages.find((m) => m.id === messageId);
    const pending = target?.pendingAction;
    if (!pending) return;
    set((state) => ({
      messages: state.messages.map((m) => (m.id === messageId ? { ...m, pendingAction: null } : m)),
    }));
    try {
      const res = await confirmPendingVoiceAction(confirm);
      const reply: ChatMessage = {
        id: uniqueId('assistant'),
        role: 'assistant',
        content: res.message,
        emotion: res.emotion,
        createdAt: new Date().toISOString(),
      };
      set((state) => ({ messages: [reply, ...state.messages] }));
    } catch {
      const errorMessage: ChatMessage = {
        id: uniqueId('error'),
        role: 'assistant',
        content: 'Не получилось подтвердить — попробуй ещё раз или напиши «да».',
        createdAt: new Date().toISOString(),
      };
      set((state) => ({
        messages: [
          errorMessage,
          ...state.messages.map((m) => (m.id === messageId ? { ...m, pendingAction: pending } : m)),
        ],
      }));
    }
  },

  executeAction: async (action: ChatAction) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      switch (action.type) {
        case 'create_task':
          await api.post('/tasks', action.data, token);
          break;
        case 'complete_task':
          if (action.data.taskId) {
            await api.patch(`/tasks/${action.data.taskId as string}/complete`, {}, token);
          }
          break;
        case 'complete_habit':
          if (action.data.habitId) {
            await api.post(`/habits/${action.data.habitId as string}/log`, {
              date: new Date().toISOString().split('T')[0],
              completed: true,
            }, token);
          }
          break;
        case 'add_expense':
          await api.post('/finance/expenses', action.data, token);
          break;
        case 'add_income':
          await api.post('/finance/incomes', action.data, token);
          break;
        default:
          break;
      }

      const confirmMessage: ChatMessage = {
        id: uniqueId('confirm'),
        role: 'assistant',
        content: getConfirmationText(action.type),
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [confirmMessage, ...state.messages],
      }));
    } catch {
      const errorMessage: ChatMessage = {
        id: uniqueId('action-error'),
        role: 'assistant',
        content: 'Не удалось выполнить действие. Попробуйте ещё раз.',
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [errorMessage, ...state.messages],
      }));
    }
  },
}));

function getConfirmationText(actionType: string): string {
  switch (actionType) {
    case 'create_task':
      return 'Задача успешно создана.';
    case 'complete_task':
      return 'Задача отмечена как выполненная.';
    case 'complete_habit':
      return 'Привычка отмечена.';
    case 'add_expense':
      return 'Расход записан.';
    case 'add_income':
      return 'Доход записан.';
    default:
      return 'Действие выполнено.';
  }
}
