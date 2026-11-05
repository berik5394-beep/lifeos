import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

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
}

export type VoiceFollowUp = { kind: 'confirm'; text: string } | { kind: 'done' };

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
  return { kind: 'done' };
}

/** «Записать» / «Отмена» → сервер исполняет (или отменяет) отложенное действие. */
export async function confirmPendingVoiceAction(
  confirm: boolean,
): Promise<{ message: string; intent: string | null }> {
  const token = useAuthStore.getState().token;
  try {
    const res = await api.post<{ message: string; intent?: string }>(
      '/voice/confirm-action',
      { confirm },
      token || undefined,
    );
    return { message: res.message, intent: res.intent ?? null };
  } catch (err) {
    // ApiError несёт status; duck-typing — в тестах модуль api замокан целиком.
    if ((err as { status?: number }).status === 409) {
      return { message: STALE_TEXT, intent: null };
    }
    throw err;
  }
}
