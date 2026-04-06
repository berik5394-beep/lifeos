import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface WeeklyGoal {
  id: string;
  userId: string;
  weekStart: string;
  goalText: string;
  completed: boolean;
  order: number;
}

interface YearlyGoal {
  id: string;
  userId: string;
  year: number;
  area: string;
  goalText: string;
  progress: number;
  habits?: { id: string; name: string; category: string }[];
}

interface GoalState {
  weeklyGoals: WeeklyGoal[];
  yearlyGoals: YearlyGoal[];
  isLoading: boolean;
  fetchWeeklyGoals: (week?: string) => Promise<void>;
  createWeeklyGoal: (weekStart: string, goalText: string) => Promise<void>;
  updateWeeklyGoal: (id: string, data: Partial<WeeklyGoal>) => Promise<void>;
  deleteWeeklyGoal: (id: string) => Promise<void>;
  fetchYearlyGoals: (year?: number) => Promise<void>;
  createYearlyGoal: (data: { year: number; area: string; goalText: string }) => Promise<void>;
  updateYearlyGoal: (id: string, data: Partial<YearlyGoal>) => Promise<void>;
  deleteYearlyGoal: (id: string) => Promise<void>;
}

export const useGoalStore = create<GoalState>((set) => ({
  weeklyGoals: [],
  yearlyGoals: [],
  isLoading: false,

  fetchWeeklyGoals: async (week?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (week) params.set('week', week);
      const query = params.toString();
      const endpoint = `/goals/weekly${query ? `?${query}` : ''}`;
      const weeklyGoals = await api.get<WeeklyGoal[]>(endpoint, token);
      set({ weeklyGoals, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createWeeklyGoal: async (weekStart: string, goalText: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const goal = await api.post<WeeklyGoal>(
      '/goals/weekly',
      { weekStart, goalText },
      token,
    );
    set((state) => ({ weeklyGoals: [...state.weeklyGoals, goal] }));
  },

  updateWeeklyGoal: async (id: string, data: Partial<WeeklyGoal>) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const updated = await api.put<WeeklyGoal>(`/goals/weekly/${id}`, data, token);
    set((state) => ({
      weeklyGoals: state.weeklyGoals.map((g) => (g.id === id ? updated : g)),
    }));
  },

  deleteWeeklyGoal: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/goals/weekly/${id}`, token);
    set((state) => ({
      weeklyGoals: state.weeklyGoals.filter((g) => g.id !== id),
    }));
  },

  fetchYearlyGoals: async (year?: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (year) params.set('year', String(year));
      const query = params.toString();
      const endpoint = `/goals/yearly${query ? `?${query}` : ''}`;
      const yearlyGoals = await api.get<YearlyGoal[]>(endpoint, token);
      set({ yearlyGoals, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createYearlyGoal: async (data: { year: number; area: string; goalText: string }) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const goal = await api.post<YearlyGoal>('/goals/yearly', data, token);
    set((state) => ({ yearlyGoals: [...state.yearlyGoals, goal] }));
  },

  updateYearlyGoal: async (id: string, data: Partial<YearlyGoal>) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const updated = await api.put<YearlyGoal>(`/goals/yearly/${id}`, data, token);
    set((state) => ({
      yearlyGoals: state.yearlyGoals.map((g) => (g.id === id ? updated : g)),
    }));
  },

  deleteYearlyGoal: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/goals/yearly/${id}`, token);
    set((state) => ({
      yearlyGoals: state.yearlyGoals.filter((g) => g.id !== id),
    }));
  },
}));
