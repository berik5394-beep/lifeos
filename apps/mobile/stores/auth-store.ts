import { create } from 'zustand';
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
  logout: () => void;
  refreshAuth: () => Promise<void>;
  loadStoredAuth: () => void;
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
      storage.set('token', data.accessToken);
      storage.set('refreshToken', data.refreshToken);
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
      storage.set('token', data.accessToken);
      storage.set('refreshToken', data.refreshToken);
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

  logout: () => {
    storage.remove('token');
    storage.remove('refreshToken');
    storage.remove('user');
    set({ token: null, refreshToken: null, user: null, error: null });
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
      storage.set('token', data.accessToken);
      storage.set('refreshToken', data.refreshToken);
      set({
        token: data.accessToken,
        refreshToken: data.refreshToken,
      });
    } catch {
      get().logout();
    }
  },

  loadStoredAuth: () => {
    const token = storage.getString('token') ?? null;
    const refreshToken = storage.getString('refreshToken') ?? null;
    const userJson = storage.getString('user');
    const user: User | null = userJson ? (JSON.parse(userJson) as User) : null;
    set({ token, refreshToken, user });
  },
}));
