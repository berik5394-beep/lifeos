import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { storage } from '@/services/storage';
import { api, ApiError } from '@/services/api';
import { CONSENT_VERSION } from '@/constants/legal-text';

interface User {
  id: string;
  email: string;
  name: string;
  currency: string;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  /**
   * Сервер ждёт согласия (16+, условия, сторонний ИИ) — не дано или политика
   * обновилась. Пока true — вместо приложения экран согласия (App Store 2026-11-10).
   */
  consentRequired: boolean;
  checkConsent: () => Promise<void>;
  acceptConsent: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** consent — галочка «16+, условия, сторонний ИИ» на экране регистрации. */
  register: (email: string, name: string, password: string, consent?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
}

/** Идёт выход — прощальные запросы уже отправлены (защита от цикла через 401). */
let loggingOut = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  refreshToken: null,
  user: null,
  isLoading: false,
  error: null,
  consentRequired: false,

  checkConsent: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const me = await api.get<{ user?: { consentRequired?: boolean } }>('/auth/me', token);
      set({ consentRequired: me.user?.consentRequired === true });
    } catch {
      // Нет сети — не держим человека снаружи; спросим при следующем запуске.
    }
  },

  acceptConsent: async () => {
    const token = get().token;
    if (!token) return;
    await api.post('/auth/consent', { ageConfirmed: true, version: CONSENT_VERSION }, token);
    set({ consentRequired: false });
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/login', { email, password });
      await SecureStore.setItemAsync('token', data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);
      storage.set('user', JSON.stringify(data.user));
      set({
        token: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка входа';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  register: async (email: string, name: string, password: string, consent = false) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/register', {
        email,
        name,
        password,
        ...(consent ? { consent: true } : {}),
      });
      await SecureStore.setItemAsync('token', data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);
      storage.set('user', JSON.stringify(data.user));
      set({
        token: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка регистрации';
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  logout: async () => {
    // Пока токен ещё есть: отписать пуши этого телефона и отозвать refresh-токены
    // на сервере (раньше не делалось — шли пуши вышедшего аккаунта). Без сети /
    // протух токен — не мешаем выходу (не дольше 3 с).
    const current = get().token;
    // Повторный вход в logout (протухший токен → 401 → refreshAuth → logout)
    // прощальные запросы не повторяет — иначе цикл.
    if (current && !loggingOut) {
      loggingOut = true;
      const bye = Promise.allSettled([
        api.delete('/notifications/register-token', current),
        api.post('/auth/logout', {}, current),
      ]);
      await Promise.race([bye, new Promise((r) => setTimeout(r, 3000))]);
      loggingOut = false;
    }
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('refreshToken');
    storage.remove('user');
    // Clear cached store data so next user starts fresh
    const { clearPersistedStores } = await import('@/services/store-persist');
    await clearPersistedStores();
    // Очередь офлайн-записей, кэш ответов, заметки недели — не следующему аккаунту.
    const { wipeUserDeviceData } = await import('@/services/offline-sync');
    await wipeUserDeviceData().catch(() => {});
    // Сторы, облачко, будильники и настройки прошлого аккаунта — не следующему.
    const { resetUserSession } = await import('@/services/session-reset');
    await resetUserSession().catch(() => {});
    set({ token: null, refreshToken: null, user: null, error: null, consentRequired: false });
  },

  deleteAccount: async (password: string) => {
    const token = get().token;
    if (!token) throw new Error('Не авторизован');
    await api.post('/auth/delete-account', { password }, token);
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('refreshToken');
    storage.remove('user');
    storage.remove('assistantStyle');
    storage.remove('assistantGender');
    storage.remove('wakeUpTime');
    storage.remove('morning_reminder');
    storage.remove('evening_review');
    storage.remove('task_reminders');
    const { clearPersistedStores } = await import('@/services/store-persist');
    await clearPersistedStores().catch(() => {});
    const { wipeUserDeviceData } = await import('@/services/offline-sync');
    await wipeUserDeviceData().catch(() => {});
    // Сторы, облачко, будильники — не достаются следующему аккаунту.
    const { resetUserSession } = await import('@/services/session-reset');
    await resetUserSession().catch(() => {});
    set({ token: null, refreshToken: null, user: null, error: null, consentRequired: false });
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const token = get().token;
    if (!token) throw new Error('Не авторизован');
    const data = await api.post<{ accessToken: string; refreshToken: string; message: string }>(
      '/auth/change-password',
      { currentPassword, newPassword },
      token,
    );
    // Update tokens after password change (server revoked old ones)
    await SecureStore.setItemAsync('token', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    set({ token: data.accessToken, refreshToken: data.refreshToken });
  },

  refreshAuth: async () => {
    const currentRefreshToken = get().refreshToken;
    if (!currentRefreshToken) {
      get().logout();
      return;
    }
    try {
      const data = await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        refreshToken: currentRefreshToken,
      });
      await SecureStore.setItemAsync('token', data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);
      set({
        token: data.accessToken,
        refreshToken: data.refreshToken,
      });
    } catch (err) {
      // Выходим, только если сервер отклонил токен. Нет сети (0), сервер
      // лежит (5xx) или лимит (429) — остаёмся в аккаунте со старым токеном:
      // раньше запуск без интернета выкидывал из приложения.
      const status = err instanceof ApiError ? err.status : -1;
      if (status === 400 || status === 401 || status === 403) await get().logout();
    }
  },

  loadStoredAuth: async () => {
    const token = await SecureStore.getItemAsync('token');
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    const userJson = storage.getString('user');
    let user: User | null = null;
    if (userJson) {
      try {
        user = JSON.parse(userJson) as User;
      } catch {
        // Corrupted JSON — clear it to prevent repeated crashes
        storage.remove('user');
      }
    }
    set({ token: token ?? null, refreshToken: refreshToken ?? null, user });
  },
}));
