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
  /** Робот-друг №2: «как ты?» без повода (по умолчанию вкл, хранится на сервере). */
  checkIns?: boolean;
  /**
   * Робот-друг №5: «режим поддержки» — когда тяжело, робот отвечает бережно,
   * а не по стилю (по умолчанию вкл; User.therapeuticMode на сервере).
   */
  therapeuticMode?: boolean;
  /** Тумблеры уведомлений Настроек (по умолчанию вкл; User.settings на сервере). */
  morningReminder?: boolean;
  eveningReview?: boolean;
  taskReminders?: boolean;
};

/** Ключ тумблера в телефоне ↔ поле профиля на сервере. */
export const NOTIFY_PREF_KEYS = {
  morningReminder: 'morning_reminder',
  eveningReview: 'evening_review',
  taskReminders: 'task_reminders',
} as const;

const KEYS: (keyof AssistantProfile)[] = ['assistantStyle', 'assistantGender', 'wakeUpTime'];

function cache(p: AssistantProfile): void {
  for (const k of KEYS) {
    const v = p[k];
    if (typeof v === 'string' && v) storage.set(k, v);
  }
  for (const [field, key] of Object.entries(NOTIFY_PREF_KEYS) as [keyof typeof NOTIFY_PREF_KEYS, string][]) {
    const v = p[field];
    if (typeof v === 'boolean') storage.setBoolean(key, v);
  }
}

/** Включён ли тумблер уведомлений (по умолчанию — да). */
export function notifyPrefOn(field: keyof typeof NOTIFY_PREF_KEYS): boolean {
  return storage.getBoolean(NOTIFY_PREF_KEYS[field]) !== false;
}

/** Сохранить на сервере (и в кэше). Ошибка — бросает: экран скажет «не сохранилось». */
export async function saveAssistantProfile(patch: AssistantProfile): Promise<void> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Войди в аккаунт.');
  // Токсичный стиль выбирают только через предупреждение «будет грубым» (Настройки,
  // знакомство) — сервер требует подтверждение (App Store 2026-11-10).
  const body = patch.assistantStyle === 'toxic' ? { ...patch, toxicConsent: true } : patch;
  await api.patch('/auth/profile', body, token);
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
      checkIns: typeof p.checkIns === 'boolean' ? p.checkIns : undefined,
      therapeuticMode: typeof p.therapeuticMode === 'boolean' ? p.therapeuticMode : undefined,
      morningReminder: typeof p.morningReminder === 'boolean' ? p.morningReminder : undefined,
      eveningReview: typeof p.eveningReview === 'boolean' ? p.eveningReview : undefined,
      taskReminders: typeof p.taskReminders === 'boolean' ? p.taskReminders : undefined,
    };
    cache(picked);
    return picked;
  } catch {
    return null;
  }
}
