import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';

/** Разбор цели длиннее обычной реплики — облачко держим дольше. */
const INTAKE_BUBBLE_MS = 20000;

/**
 * Разбор цели (деньги/время/привычка + «да») — фоном: сохранение не ждёт
 * расчёта, робот скажет облачком, когда придёт. Сбой/флаг выкл. — молчит.
 * Promise.resolve().then: даже синхронный сбой вызова не ломает сохранение цели.
 */
function requestIntake(path: string, token: string): void {
  void Promise.resolve()
    .then(() => api.post<{ text: string | null }>(path, {}, token))
    .then((r) => {
      if (r?.text) useRobotReactionStore.getState().react('thinking', r.text, INTAKE_BUBBLE_MS);
    })
    .catch(() => {});
}

interface WeeklyGoal {
  id: string;
  userId: string;
  weekStart: string;
  goalText: string;
  completed: boolean;
  order: number;
}

export interface MonthlyGoal {
  id: string;
  userId: string;
  monthStart: string;
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
  /** Числовая величина цели (1 000 000 ₸, 50 книг); null — без числа. */
  target?: number | null;
  habits?: { id: string; name: string; category: string }[];
  /** Денежная цель: накоплено (доходы − расходы с даты цели) и % — тот же расчёт, что у робота. */
  saved?: number;
  liveProgress?: number;
  /** Привязанные привычки: дней с отметкой из последних 30 (регулярность, не % цели). */
  habitDays?: { done: number; of: number };
}

interface GoalState {
  weeklyGoals: WeeklyGoal[];
  yearlyGoals: YearlyGoal[];
  isLoading: boolean;
  fetchWeeklyGoals: (week?: string) => Promise<void>;
  createWeeklyGoal: (weekStart: string, goalText: string) => Promise<void>;
  updateWeeklyGoal: (id: string, data: Partial<WeeklyGoal>) => Promise<void>;
  deleteWeeklyGoal: (id: string) => Promise<void>;
  /** Цели на месяц (их ставит и робот). month — 'YYYY-MM'. */
  monthlyGoals: MonthlyGoal[];
  fetchMonthlyGoals: (month?: string) => Promise<void>;
  createMonthlyGoal: (month: string, goalText: string) => Promise<void>;
  updateMonthlyGoal: (id: string, data: Partial<Pick<MonthlyGoal, 'goalText' | 'completed'>>) => Promise<void>;
  deleteMonthlyGoal: (id: string) => Promise<void>;
  fetchYearlyGoals: (year?: number) => Promise<void>;
  createYearlyGoal: (data: { year: number; area: string; goalText: string; target?: number }) => Promise<void>;
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
    requestIntake(`/goals/weekly/${goal.id}/intake`, token);
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

  monthlyGoals: [],

  fetchMonthlyGoals: async (month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const monthlyGoals = await api.get<MonthlyGoal[]>(`/goals/monthly${month ? `?month=${month}` : ''}`, token);
    set({ monthlyGoals });
  },

  createMonthlyGoal: async (month: string, goalText: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const goal = await api.post<MonthlyGoal>('/goals/monthly', { month, goalText }, token);
    set((state) => ({ monthlyGoals: [...state.monthlyGoals, goal] }));
  },

  updateMonthlyGoal: async (id, data) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    // Галочка сразу; сбой — откат.
    const prev = useGoalStore.getState().monthlyGoals;
    set((state) => ({ monthlyGoals: state.monthlyGoals.map((g) => (g.id === id ? { ...g, ...data } : g)) }));
    try {
      const updated = await api.put<MonthlyGoal>(`/goals/monthly/${id}`, data, token);
      set((state) => ({ monthlyGoals: state.monthlyGoals.map((g) => (g.id === id ? updated : g)) }));
    } catch (err) {
      set({ monthlyGoals: prev });
      throw err;
    }
  },

  deleteMonthlyGoal: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    await api.delete(`/goals/monthly/${id}`, token);
    set((state) => ({ monthlyGoals: state.monthlyGoals.filter((g) => g.id !== id) }));
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

  createYearlyGoal: async (data: { year: number; area: string; goalText: string; target?: number }) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const goal = await api.post<YearlyGoal>('/goals/yearly', data, token);
    set((state) => ({ yearlyGoals: [...state.yearlyGoals, goal] }));
    requestIntake(`/goals/yearly/${goal.id}/intake`, token);
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
