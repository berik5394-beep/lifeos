import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { normalizeEmotion, type RobotEmotion } from '@/services/robot-emotion';

/**
 * voice-one-brain: что мобилка делает ПОСЛЕ ответа сервера на голосовую
 * команду. Сервер (единый мозг) уже всё исполнил — кроме денег/необратимого,
 * где он вернул pendingAction и ждёт подтверждения. Клиент НИЧЕГО не исполняет.
 */
export interface PendingActionInfo {
  action: string;
  input: Record<string, unknown>;
}

export interface ProcessResponse {
  intent?: { action: string } | null;
  response?: string;
  pendingAction?: PendingActionInfo | null;
  confirmationText?: string | null;
  /** Эмоция робота на этот ход (сервер, по фактам). */
  emotion?: string | null;
  /** «Открой задачи» → ключ панели (робот-эпик Часть 3). */
  openPanel?: string | null;
}

export type VoiceFollowUp =
  | { kind: 'confirm'; text: string } // «Подтвердить / Отмена»
  | { kind: 'ask'; text: string } // слот-вопрос «На что потратил?» — показать, ответ словами
  | { kind: 'done' };

const DEFAULT_CONFIRM_TEXT = 'Подтвердить действие?';
const STALE_TEXT = 'Нечего подтверждать — предложение устарело. Повтори запрос.';

/** Слот-вопрос FSM («На что потратил?») — ждёт ответа СЛОВАМИ, кнопки «Записать» тут нет смысла. */
export function isConfirmable(p: PendingActionInfo | null | undefined): p is PendingActionInfo {
  if (!p) return false;
  const input = p.input ?? {};
  return !input.__awaitingCategory && !input.__awaitingSource;
}

export function planVoiceFollowUp(res: ProcessResponse): VoiceFollowUp {
  if (isConfirmable(res.pendingAction)) {
    return { kind: 'confirm', text: res.confirmationText || DEFAULT_CONFIRM_TEXT };
  }
  if (res.pendingAction) {
    // Слот-вопрос: следующая фраза юзера станет значением слота (категорией) —
    // показываем вопрос текстом, чтобы он не прошёл мимо при выключенном звуке.
    return { kind: 'ask', text: res.confirmationText || res.response || 'Уточни, пожалуйста.' };
  }
  return { kind: 'done' };
}

/** «Записать» / «Отмена» → сервер исполняет (или отменяет) отложенное действие. */
export async function confirmPendingVoiceAction(
  confirm: boolean,
): Promise<{ message: string; intent: string | null; emotion: RobotEmotion }> {
  const token = useAuthStore.getState().token;
  try {
    const res = await api.post<{ message: string; intent?: string; emotion?: string }>(
      '/voice/confirm-action',
      { confirm },
      token || undefined,
    );
    return { message: res.message, intent: res.intent ?? null, emotion: normalizeEmotion(res.emotion) };
  } catch (err) {
    // ApiError несёт status; duck-typing — в тестах модуль api замокан целиком.
    if ((err as { status?: number }).status === 409) {
      return { message: STALE_TEXT, intent: null, emotion: 'worried' };
    }
    throw err;
  }
}
