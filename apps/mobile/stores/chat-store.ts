import { create } from 'zustand';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { confirmPendingVoiceAction, isConfirmable, type PendingActionInfo } from '@/services/voice-followup';
import { normalizeEmotion, type RobotEmotion } from '@/services/robot-emotion';
import { useScheduleStore, RESCHEDULE_ACTION, type RescheduleProposal } from '@/stores/schedule-store';
import { formatDate } from '@/utils/dates';

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
  /** «Открой задачи» → ключ панели, которую экран откроет (Часть 3). */
  openPanel?: string | null;
  /** 'proposal' — предложение сдвинуть график после сохранения в карточке. */
  kind?: 'proposal';
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
  /** Перегруз дня: предложение сервера из карточки → реплика робота (+ кнопки, если ждёт подтверждения). */
  showProposal: (proposal: RescheduleProposal) => void;
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
      const data = await api.post<{ message: string; actions?: ChatAction[]; pendingAction?: PendingActionInfo | null; emotion?: string; openPanel?: string | null }>(
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
        openPanel: data.openPanel ?? null,
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [assistantMessage, ...state.messages],
        isLoading: false,
      }));
      // Мозг мог что-то сделать (отметил привычку, добавил задачу) — открытая
      // панель перечитает свои данные. Микрофон теперь один, у поля ввода.
      useScheduleStore.getState().bump();
    } catch (err) {
      // Дневной лимит (429) и «нет интернета» — показываем понятный текст сервера/сети.
      const known = err instanceof ApiError && (err.status === 429 || err.status === 0);
      const errorMessage: ChatMessage = {
        id: uniqueId('error'),
        role: 'assistant',
        content: known ? err.message : 'Произошла ошибка. Попробуйте ещё раз.',
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
        // Стор хранит НОВЫЕ первыми ([0] — последний ответ: облачко робота).
        // Сервер отдаёт новые первыми, а прежний .reverse() переворачивал в
        // старые-первыми. Сортируем по времени — верно при любом порядке сервера.
        const reversed = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (offset === 0) {
          // Шторка «История» открывается много раз (Часть 5) и каждый раз
          // перечитывает сервер. Серверные строки без кнопок подтверждения/эмоции
          // и с другими id → оставляем ЛОКАЛЬНУЮ копию того же сообщения (та же
          // роль и текст), иначе кнопки «Подтвердить» пропадали бы.
          const pool = [...state.messages];
          const merged = reversed.map((m) => {
            const i = pool.findIndex((l) => l.role === m.role && l.content === m.content);
            return i >= 0 ? pool.splice(i, 1)[0] : m;
          });
          return { messages: merged, hasMore: serverHasMore };
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
      const res = await confirmPendingVoiceAction(confirm, pending.action);
      // График сдвинут → открытые экраны задач/календаря перечитают данные.
      // Подтверждённое действие (сдвиг графика, доход, задача) → открытые экраны перечитают данные.
      // Устаревшее предложение (409) приходит без intent — там ничего не сделано.
      if (confirm && res.intent) useScheduleStore.getState().bump();
      const reply: ChatMessage = {
        id: uniqueId('assistant'),
        role: 'assistant',
        content: res.message,
        emotion: res.emotion,
        // Подтверждение поставило новый вопрос («Записать ещё раз?») → под ним те же
        // кнопки; слот-вопрос (ответ словами) — без кнопок, как у обычных ответов.
        pendingAction: isConfirmable(res.pendingAction) ? res.pendingAction : null,
        // Ответ на предложение перегруза — тоже виден поверх открытой карточки.
        ...(target?.kind ? { kind: target.kind } : {}),
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

  showProposal: (proposal: RescheduleProposal) => {
    const message: ChatMessage = {
      id: uniqueId('proposal'),
      role: 'assistant',
      content: proposal.text,
      kind: 'proposal',
      emotion: 'worried',
      pendingAction: proposal.staged ? { action: RESCHEDULE_ACTION, input: {} } : null,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      // Старые кнопки снимаем: на сервере ожидает только одно (последнее) предложение.
      messages: [message, ...state.messages.map((m) => (m.pendingAction && proposal.staged ? { ...m, pendingAction: null } : m))],
    }));
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
              date: formatDate(new Date()), // местная дата, не UTC
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
