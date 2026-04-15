import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { persistStoreData } from '@/services/store-persist';

interface Habit {
  id: string;
  userId: string;
  name: string;
  category: string;
  frequency: string;
  goalId: string | null;
  order: number;
  active: boolean;
  createdAt: string;
}

interface HabitLog {
  id: string;
  habitId: string;
  userId: string;
  date: string;
  completed: boolean;
  autoCompleted: boolean;
}

interface HabitStats {
  habitId: string;
  habitName: string;
  total: number;
  completed: number;
  streak: number;
}

interface CreateHabitData {
  name: string;
  category: string;
  frequency: string;
}

interface UpdateHabitData {
  name?: string;
  category?: string;
  frequency?: string;
  active?: boolean;
  order?: number;
  goalId?: string | null;
}

interface HabitState {
  habits: Habit[];
  logs: Record<string, HabitLog[]>;
  stats: HabitStats[];
  isLoading: boolean;
  fetchHabits: () => Promise<void>;
  createHabit: (data: CreateHabitData) => Promise<void>;
  updateHabit: (id: string, data: UpdateHabitData) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  toggleHabitLog: (habitId: string, date: string, completed: boolean) => Promise<void>;
  fetchStats: (month: string) => Promise<void>;
}

export const useHabitStore = create<HabitState>((set) => ({
  habits: [],
  logs: {},
  stats: [],
  isLoading: false,

  fetchHabits: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const habits = await api.get<Habit[]>('/habits', token);
      set({ habits, isLoading: false });
      persistStoreData('habits', habits).catch(() => {});
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createHabit: async (data: CreateHabitData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const habit = await api.post<Habit>('/habits', data, token);
      set((state) => ({ habits: [...state.habits, habit] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при создании привычки';
      throw new Error(msg);
    }
  },

  updateHabit: async (id: string, data: UpdateHabitData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const updated = await api.put<Habit>(`/habits/${id}`, data, token);
      set((state) => ({
        habits: state.habits.map((h) => (h.id === id ? updated : h)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при обновлении привычки';
      throw new Error(msg);
    }
  },

  deleteHabit: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/habits/${id}`, token);
      set((state) => ({
        habits: state.habits.filter((h) => h.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении привычки';
      throw new Error(msg);
    }
  },

  toggleHabitLog: async (habitId: string, date: string, completed: boolean) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const log = await api.post<HabitLog>(
        `/habits/${habitId}/log`,
        { date, completed },
        token,
      );

      set((state) => {
        const dateLogs = state.logs[date] ?? [];
        const existingIndex = dateLogs.findIndex((l) => l.habitId === habitId);
        const updatedLogs =
          existingIndex >= 0
            ? dateLogs.map((l, i) => (i === existingIndex ? log : l))
            : [...dateLogs, log];

        return {
          logs: { ...state.logs, [date]: updatedLogs },
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при отметке привычки';
      throw new Error(msg);
    }
  },

  fetchStats: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const stats = await api.get<HabitStats[]>(`/habits/stats/${month}`, token);
      set({ stats });
    } catch {
      // Stats fetch failed silently
    }
  },
}));
