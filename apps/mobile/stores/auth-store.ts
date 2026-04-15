import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { storage } from '@/services/storage';
import { api } from '@/services/api';

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
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  refreshToken: null,
  user: null,
  isLoading: false,
  error: null,

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

  register: async (email: string, name: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/register', {
        email,
        name,
        password,
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
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('refreshToken');
    storage.remove('user');
    // Clear cached store data so next user starts fresh
    const { clearPersistedStores } = await import('@/services/store-persist');
    await clearPersistedStores();
    set({ token: null, refreshToken: null, user: null, error: null });
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
    set({ token: null, refreshToken: null, user: null, error: null });
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
    } catch {
      await get().logout();
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
