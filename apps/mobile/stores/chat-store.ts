import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface ChatAction {
  type: string;
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
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
  sendMessage: (text: string) => Promise<void>;
  fetchHistory: (offset?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  executeAction: (action: ChatAction) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  hasMore: true,

  sendMessage: async (text: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [userMessage, ...state.messages],
      isLoading: true,
    }));

    try {
      const data = await api.post<ChatResponse>(
        '/voice/chat',
        { message: text },
        token,
      );

      set((state) => ({
        messages: [data.message, ...state.messages],
        isLoading: false,
      }));
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
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
      const data = await api.get<ChatHistoryResponse>(
        `/chat/history?limit=20&offset=${currentOffset}`,
        token,
      );

      set((state) => ({
        messages: offset === 0
          ? data.messages.reverse()
          : [...state.messages, ...data.messages.reverse()],
        hasMore: data.hasMore,
      }));
    } catch {
      // Silently fail for history fetch
    }
  },

  clearHistory: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete('/chat/history', token);
      set({ messages: [], hasMore: false });
    } catch {
      // Silently fail
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
        id: `confirm-${Date.now()}`,
        role: 'assistant',
        content: getConfirmationText(action.type),
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [confirmMessage, ...state.messages],
      }));
    } catch {
      const errorMessage: ChatMessage = {
        id: `action-error-${Date.now()}`,
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
