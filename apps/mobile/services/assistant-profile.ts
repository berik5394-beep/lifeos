import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Стиль, пол ассистента и время пробуждения. Раньше хранились только в
 * телефоне: мозг на сервере отвечал не в выбранном стиле, а утренний бриф
 * приходил по серверному wakeUpTime. Теперь сервер — источник правды,
 * телефон — кэш (для голоса будильника офлайн).
 */
export type AssistantProfile = {
  assistantStyle?: 'friendly' | 'strict' | 'calm' | 'toxic';
  assistantGender?: 'female' | 'male';
  wakeUpTime?: string;
};

const KEYS: (keyof AssistantProfile)[] = ['assistantStyle', 'assistantGender', 'wakeUpTime'];

function cache(p: AssistantProfile): void {
  for (const k of KEYS) {
    const v = p[k];
    if (typeof v === 'string' && v) storage.set(k, v);
  }
}

/** Сохранить на сервере (и в кэше). Ошибка — бросает: экран скажет «не сохранилось». */
export async function saveAssistantProfile(patch: AssistantProfile): Promise<void> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Войди в аккаунт.');
  await api.patch('/auth/profile', patch, token);
  cache(patch);
}

/** Подтянуть с сервера в кэш; вернуть то, что пришло (или null без сети). */
export async function loadAssistantProfile(): Promise<AssistantProfile | null> {
  const token = useAuthStore.getState().token;
  if (!token) return null;
  try {
    const me = await api.get<AssistantProfile & { user?: AssistantProfile }>('/auth/me', token);
    const p = me.user ?? me;
    const picked: AssistantProfile = {
      assistantStyle: p.assistantStyle,
      assistantGender: p.assistantGender,
      wakeUpTime: p.wakeUpTime,
    };
    cache(picked);
    return picked;
  } catch {
    return null;
  }
}
