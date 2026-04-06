import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface Integration {
  id: string;
  provider: string;
  active: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
}

interface IntegrationState {
  integrations: Integration[];
  isLoading: boolean;
  fetchIntegrations: () => Promise<void>;
  connectGoogleCalendar: (accessToken: string, refreshToken: string) => Promise<void>;
  syncGoogleCalendar: () => Promise<void>;
  connectTelegram: (chatId: string, username?: string) => Promise<void>;
  disconnect: (provider: string) => Promise<void>;
  isConnected: (provider: string) => boolean;
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

  connectGoogleCalendar: async (accessToken: string, refreshToken: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const integration = await api.post<Integration>(
        '/integrations/google-calendar/connect',
        { accessToken, refreshToken },
        token,
      );
      set((state) => ({
        integrations: [...state.integrations, integration],
        isLoading: false,
      }));
    } catch (err) {
      console.error('Ошибка подключения Google Calendar:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  syncGoogleCalendar: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      await api.post<{ synced: number }>(
        '/integrations/google-calendar/sync',
        {},
        token,
      );
      set({ isLoading: false });
    } catch (err) {
      console.error('Ошибка синхронизации Google Calendar:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  connectTelegram: async (chatId: string, username?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const integration = await api.post<Integration>(
        '/integrations/telegram/connect',
        { chatId, username },
        token,
      );
      set((state) => ({
        integrations: [...state.integrations, integration],
        isLoading: false,
      }));
    } catch (err) {
      console.error('Ошибка подключения Telegram:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  disconnect: async (provider: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      await api.delete(`/integrations/${provider}`, token);
      set((state) => ({
        integrations: state.integrations.filter((i) => i.provider !== provider),
        isLoading: false,
      }));
    } catch (err) {
      console.error('Ошибка отключения интеграции:', err);
      set({ isLoading: false });
      throw err;
    }
  },

  isConnected: (provider: string): boolean => {
    return get().integrations.some((i) => i.provider === provider && i.active);
  },
}));
