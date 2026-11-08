import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useScheduleStore } from '@/stores/schedule-store';

/**
 * Ключ провайдера как на сервере: 'google-calendar' → 'google_calendar'.
 * Раньше экран спрашивал 'google-calendar', а сервер хранит 'google_calendar' —
 * подключённый Google выглядел неподключённым, «Отключить» отвечало 404.
 */
export const providerKey = (p: string) => p.replace(/-/g, '_');

/** Право Gmail «отправлять письма» (выдаётся при подключении Google). */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

interface Integration {
  id: string;
  provider: string;
  active: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface TelegramLink {
  code: string;
  deepLink: string;
  expiresAt: string;
}

interface IntegrationState {
  integrations: Integration[];
  isLoading: boolean;
  fetchIntegrations: () => Promise<void>;
  getGoogleAuthUrl: () => Promise<string | null>;
  /** Итог с сервера («2 из Google, 1 в Google») или null. */
  syncGoogleCalendar: () => Promise<string | null>;
  /** Одноразовый код привязки + deep-link в бота (чат доказывает владение сам). */
  requestTelegramLink: () => Promise<TelegramLink | null>;
  disconnect: (provider: string) => Promise<void>;
  isConnected: (provider: string) => boolean;
  /** Google выдал право отправлять письма (робот пишет письма после «да»). */
  canSendMail: () => boolean;
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  integrations: [],
  isLoading: false,

  fetchIntegrations: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const data = await api.get<Integration[]>('/integrations', token);
      set({ integrations: data, isLoading: false });
    } catch (err) {
      console.error('Ошибка загрузки интеграций:', err);
      set({ isLoading: false });
    }
  },

  // Phase 3.1: серверный OAuth-redirect. Берём у сервера ссылку
  // авторизации (PKCE+state живут на сервере) — мобилка только
  // открывает её в браузере. Токенов клиент не видит.
  getGoogleAuthUrl: async (): Promise<string | null> => {
    const token = useAuthStore.getState().token;
    if (!token) return null;
    const res = await api.get<{ url: string }>(
      '/integrations/google-calendar/auth-url',
      token,
    );
    return res.url ?? null;
  },

  syncGoogleCalendar: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return null;

    set({ isLoading: true });
    try {
      // Сервер отдаёт eventsImported/eventsExported/message — раньше ответ
      // выбрасывался и экран писал общее «синхронизирован».
      const res = await api.post<{ synced: boolean; eventsImported?: number; eventsExported?: number; message?: string }>(
        '/integrations/google-calendar/sync',
        {},
        token,
      );
      set({ isLoading: false });
      // Календарь и экраны перечитают встречи.
      useScheduleStore.getState().bump();
      return res?.message ?? null;
    } catch (err) {
      console.error('Ошибка синхронизации Google Calendar:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  requestTelegramLink: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return null;
    // Привязка по коду: сервер выдаёт код, бот получает его ИЗ чата
    // (/start link_<код>) — подделать чужой чат нельзя. Ручной Chat ID отключён.
    return api.post<TelegramLink>('/integrations/telegram/link-code', {}, token);
  },

  disconnect: async (provider: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      await api.delete(`/integrations/${providerKey(provider)}`, token);
      set((state) => ({
        integrations: state.integrations.filter((i) => providerKey(i.provider) !== providerKey(provider)),
        isLoading: false,
      }));
    } catch (err) {
      console.error('Ошибка отключения интеграции:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  isConnected: (provider: string): boolean => {
    return get().integrations.some((i) => providerKey(i.provider) === providerKey(provider) && i.active);
  },

  canSendMail: (): boolean => {
    const g = get().integrations.find((i) => i.provider === 'google_calendar' && i.active);
    const scopes = g?.settings?.scopes;
    return Array.isArray(scopes) && scopes.includes(GMAIL_SEND_SCOPE);
  },
}));
