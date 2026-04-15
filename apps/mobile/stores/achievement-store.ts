import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export interface Achievement {
  key: string;
  type: string;
  name: string;
  description?: string;
  unlocked: boolean;
  claimed: boolean;
  unlockedAt?: string;
}

export interface ThemeInfo {
  key: string;
  name: string;
  unlocked: boolean;
  active: boolean;
}

interface AchievementStore {
  achievements: Achievement[];
  themes: ThemeInfo[];
  isLoading: boolean;
  fetchAchievements: () => Promise<void>;
  claimAchievement: (key: string) => Promise<void>;
  fetchThemes: () => Promise<void>;
  setActiveTheme: (theme: string) => Promise<void>;
}

export const useAchievementStore = create<AchievementStore>((set, get) => ({
  achievements: [],
  themes: [],
  isLoading: false,

  fetchAchievements: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    set({ isLoading: true });
    try {
      const raw = await api.get<Achievement[] | { achievements: Achievement[] }>('/achievements', token);
      const list = Array.isArray(raw) ? raw : (raw.achievements ?? []);
      set({ achievements: list, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  claimAchievement: async (key: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const updated = await api.post<Achievement>(`/achievements/claim/${key}`, {}, token);
      set({
        achievements: get().achievements.map((a) =>
          a.key === key ? { ...a, ...updated, claimed: true } : a,
        ),
      });
    } catch {
      // Error handled silently
    }
  },

  fetchThemes: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const raw = await api.get<ThemeInfo[] | { themes: ThemeInfo[] }>('/themes', token);
      const list = Array.isArray(raw) ? raw : (raw.themes ?? []);
      set({ themes: list });
    } catch {
      // Error handled silently
    }
  },

  setActiveTheme: async (theme: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      await api.put<ThemeInfo>('/themes/active', { theme }, token);
      set({
        themes: get().themes.map((t) => ({
          ...t,
          active: t.key === theme,
        })),
      });
    } catch {
      // Error handled silently
    }
  },
}));
