import { create } from 'zustand';
import { api, ApiError, BRAIN_TIMEOUT_MS } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { confirmPendingVoiceAction, isConfirmable, type PendingActionInfo } from '@/services/voice-followup';
import { normalizeEmotion, type RobotEmotion } from '@/services/robot-emotion';
import { useScheduleStore, RESCHEDULE_ACTION, type RescheduleProposal } from '@/stores/schedule-store';
import { formatDate } from '@/utils/dates';
import { createPhraseVoice, speakReply } from '@/services/tts-voice';
import { createSentenceSpeaker } from '@/services/sentence-speaker';
import { streamChat, StreamUnavailableError } from '@/services/chat-stream';

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
  /** spoken — сказано голосом: ответ короче и озвучивается. */
  sendMessage: (text: string, webSearch?: boolean, opts?: { spoken?: boolean }) => Promise<void>;
  /** Текст, который не дошёл до робота (нет сети, сбой) — строка ввода вернёт его. */
  failedDraft: string | null;
  /** Какая строка ввода отправила последней — ей и вернуть текст. */
  draftOwner: string | null;
  takeFailedDraft: (owner: string) => string | null;
  /** Фраза-пример из «Как пользоваться»: строка ввода на экране `for` вставит её (не отправит). */
  prefill: { text: string; for: string } | null;
  setPrefill: (p: { text: string; for: string } | null) => void;
  fetchHistory: (offset?: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  executeAction: (action: ChatAction) => Promise<void>;
  confirmPendingAction: (messageId: string, confirm: boolean) => Promise<void>;
  /** Перегруз дня: предложение сервера из карточки → реплика робота (+ кнопки, если ждёт подтверждения). */
  showProposal: (proposal: RescheduleProposal) => void;
  /** Нудж робота (с сервера, при открытии приложения) → облачко у робота + история. */
  showNudge: (insightId: string, content: string) => void;
  /**
   * Вопрос «Записать?» с кнопками, поставленный НЕ ходом чата (чек с фото):
   * сервер уже ждёт ответа (pending). Возвращает id сообщения — экран может
   * сразу подтвердить через confirmPendingAction (тот же путь, что в чате).
   */
  showPendingQuestion: (content: string, pending: PendingActionInfo) => string;
}

/**
 * После перезапуска история с сервера приходит без кнопок «Подтвердить», хотя
 * сервер всё ещё ждёт ответа (GET /voice/pending-action раньше никто не звал).
 * Возвращаем кнопки на ТО сообщение, текст которого = вопрос подтверждения.
 */
async function restorePendingButtons(
  token: string,
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): Promise<void> {
  if (get().messages.some((m) => m.pendingAction)) return;
  try {
    const r = await api.get<{ pending: PendingActionInfo | null; confirmationText?: string }>('/voice/pending-action', token);
    if (!r?.pending || !isConfirmable(r.pending) || !r.confirmationText) return;
    const text = r.confirmationText.trim();
    set((state) => {
      // Пока ждали ответ, могло прийти новое предложение со своими кнопками — не трогаем.
      if (state.messages.some((m) => m.pendingAction)) return {};
      // Перед подтверждением траты может стоять фраза робота в его стиле (2026-11-10) —
      // ищем сообщение, которое ЗАКАНЧИВАЕТСЯ текстом подтверждения.
      const i = state.messages.findIndex((m) => m.role === 'assistant' && m.content.trim().endsWith(text));
      if (i < 0) return {};
      return { messages: state.messages.map((m, j) => (j === i ? { ...m, pendingAction: r.pending } : m)) };
    });
  } catch {
    /* не вышло — просто без кнопок, как раньше */
  }
}

let _msgSeq = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_msgSeq}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  failedDraft: null,
  draftOwner: null,
  prefill: null,
  setPrefill: (p) => set({ prefill: p }),
  takeFailedDraft: (owner: string) => {
    const { failedDraft: d, draftOwner } = get();
    if (d === null || (draftOwner !== null && draftOwner !== owner)) return null;
    set({ failedDraft: null });
    return d;
  },
  hasMore: true,

  showPendingQuestion: (content: string, pending: PendingActionInfo) => {
    const id = uniqueId('pending');
    const message: ChatMessage = {
      id,
      role: 'assistant',
      content,
      emotion: 'thinking',
      pendingAction: isConfirmable(pending) ? pending : null,
      createdAt: new Date().toISOString(),
    };
    // Старые кнопки снимаем: на сервере ждёт только одно (последнее) действие.
    set((state) => ({ messages: [message, ...state.messages.map((m) => (m.pendingAction ? { ...m, pendingAction: null } : m))] }));
    return id;
  },

  showNudge: (insightId: string, content: string) => {
    const id = `nudge-${insightId}`;
    if (!content.trim() || get().messages.some((m) => m.id === id)) return;
    set((state) => ({
      messages: [{ id, role: 'assistant', content, createdAt: new Date().toISOString() }, ...state.messages],
    }));
  },

  sendMessage: async (text: string, webSearch?: boolean, opts?: { spoken?: boolean }) => {
    const spoken = opts?.spoken === true;
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

    // Потоковый ответ (текст и голос): облачко растёт по мере ответа; сказали голосом —
    // готовые фразы сразу звучат (Джарвис, jarvis-roadmap №5).
    const liveId = uniqueId('assistant');
    let live = '';
    const voice = spoken ? createPhraseVoice() : null;
    const speaker = voice ? createSentenceSpeaker(voice.say, voice.stop) : null;
    const onDelta = (x: string) => {
      live += x;
      speaker?.push(x);
      const content = live;
      set((state) => {
        const exists = state.messages.some((m) => m.id === liveId);
        const msg: ChatMessage = { id: liveId, role: 'assistant', content, createdAt: new Date().toISOString() };
        return {
          messages: exists ? state.messages.map((m) => (m.id === liveId ? { ...m, content } : m)) : [msg, ...state.messages],
          isLoading: false,
        };
      });
    };

    type Reply = { message: string; actions?: ChatAction[]; pendingAction?: PendingActionInfo | null; emotion?: string; openPanel?: string | null };
    const viaPost = () =>
      api.post<Reply>(
        '/voice/chat',
        { text, webSearch: webSearch ?? false, ...(spoken ? { voice: true } : {}) },
        token,
        // Мозг думает дольше 15 с (поиск, инструменты): раньше телефон обрывал
        // ожидание, писал «нет интернета», а сервер доделывал — повтор = дубль.
        { timeoutMs: BRAIN_TIMEOUT_MS },
      );

    try {
      let data: Reply;
      let streamed: string | null = null;
      // Поток и для текста (2026-11-10, скорость): первые слова в облачке через
      // ~1,5 с вместо целого ответа через ~6 с. Итог в конце заменяет собранный
      // текст (сервер мог дописать «Готово: …» или сменить ответ запасным путём).
      try {
        const done = await streamChat(text, token, onDelta, { voice: spoken, webSearch: webSearch ?? false });
        data = done;
        streamed = done.streamed ?? '';
      } catch (err) {
        // Сервер без потока (404) / вход протух (401) — сообщение не обработано: обычным путём.
        if (!(err instanceof StreamUnavailableError)) throw err;
        data = await viaPost();
      }

      const assistantMessage: ChatMessage = {
        id: liveId,
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
        messages: state.messages.some((m) => m.id === liveId)
          ? state.messages.map((m) => (m.id === liveId ? assistantMessage : m))
          : [assistantMessage, ...state.messages],
        isLoading: false,
      }));
      // Сказали голосом — договорить (поток) или сказать итог (обычный путь).
      if (speaker) speaker.finish(data.message, streamed ?? '');
      // Мозг мог что-то сделать (отметил привычку, добавил задачу) — открытая
      // панель перечитает свои данные. Микрофон теперь один, у поля ввода.
      useScheduleStore.getState().bump();
    } catch (err) {
      // Дневной лимит (429) и «нет интернета» — показываем понятный текст сервера/сети.
      // 429 лимит, 0 нет сети, 408 «думаю дольше обычного» — показываем честный текст.
      const known = err instanceof ApiError && (err.status === 429 || err.status === 0 || err.status === 408);
      const errorMessage: ChatMessage = {
        id: uniqueId('error'),
        role: 'assistant',
        content: known ? err.message : 'Произошла ошибка. Попробуйте ещё раз.',
        createdAt: new Date().toISOString(),
      };

      // Напечатанное не пропадает: строка ввода вернёт его, можно отправить ещё
      // раз. Кроме 408 — сервер ещё думает и может выполнить, повтор = дубль.
      const retryable = !(err instanceof ApiError && err.status === 408);
      if (spoken) {
        voice?.stop();
        void speakReply(errorMessage.content);
      }
      set((state) => ({
        // Недоговорённый поток убираем — вместо него честная ошибка.
        messages: [errorMessage, ...state.messages.filter((m) => m.id !== liveId)],
        isLoading: false,
        failedDraft: retryable ? text : null,
      }));
    }
  },

  fetchHistory: async (offset?: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const currentOffset = offset ?? get().messages.length;
      // «Ещё» — курсором «старше самого старого на экране», а не смещением по числу
      // строк на экране (там и локальные облачка: нуджи, ошибки — сообщения пропускались).
      const oldest = get().messages.reduce<string | null>((m, x) => (!m || x.createdAt < m ? x.createdAt : m), null);
      const query = offset === 0 || !oldest ? 'offset=0' : `before=${encodeURIComponent(oldest)}`;
      const raw = await api.get<ChatMessage[] | ChatHistoryResponse>(`/chat/history?limit=20&${query}`, token);

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
          // Локальные облачка (нуджи, ошибки, «открыл вкладку»), которых нет на
          // сервере, — не стираем, если они не старше загруженного окна.
          const oldestServer = reversed.length ? reversed[reversed.length - 1].createdAt : '';
          const localOnly = pool.filter((l) => l.createdAt >= oldestServer);
          const all = [...merged, ...localOnly].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return { messages: all, hasMore: serverHasMore };
        }
        const existingIds = new Set(state.messages.map(m => m.id));
        const newMessages = reversed.filter(m => !existingIds.has(m.id));
        return { messages: [...state.messages, ...newMessages], hasMore: serverHasMore };
      });
      if (currentOffset === 0) await restorePendingButtons(token, set, get);
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
            await api.patch(`/tasks/${action.data.taskId as string}/complete`, { completed: true }, token);
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
