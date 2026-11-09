import { create } from 'zustand';
import { api, isOfflineQueued, QUEUE_OFFLINE } from '@/services/api';
import { offlineId } from '@/utils/offline-id';
import { useAuthStore } from '@/stores/auth-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
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
  /** Отмечается сама по шагам из «Здоровья» (сервер: habit-auto). */
  autoComplete?: { type: 'steps'; min: number } | null;
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
  /** Сразу привязать к годовой цели (окно «Привязать привычку» на «Целях»). */
  goalId?: string | null;
}

interface UpdateHabitData {
  name?: string;
  category?: string;
  frequency?: string;
  active?: boolean;
  order?: number;
  goalId?: string | null;
  autoComplete?: { type: 'steps'; min: number } | null;
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
  /** Отметки с сервера за [from..to] ('YYYY-MM-DD'): видны отметки голосом/чатом
   *  и с других устройств; после переустановки история не пропадает. */
  fetchLogs: (from: string, to: string) => Promise<void>;
}

interface ServerHabitLog {
  id: string;
  habitId: string;
  date: string; // 'YYYY-MM-DD' — календарная дата (habit-day)
  completed: boolean;
}

function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length <= 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const useHabitStore = create<HabitState>((set, get) => ({
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

    const localId = offlineId();
    try {
      const habit = await api.post<Habit>('/habits', data, token, { ...QUEUE_OFFLINE, localId });
      set((state) => ({ habits: [...state.habits, habit] }));
    } catch (err) {
      // Без сети: запись в очереди — привычка видна сразу, после отправки перечитается.
      if (isOfflineQueued(err)) {
        const local: Habit = {
          id: localId,
          userId: '',
          ...data,
          goalId: data.goalId ?? null,
          order: get().habits.length,
          active: true,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ habits: [...state.habits, local] }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при создании привычки';
      throw new Error(msg);
    }
  },

  updateHabit: async (id: string, data: UpdateHabitData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const updated = await api.put<Habit>(`/habits/${id}`, data, token, QUEUE_OFFLINE);
      set((state) => ({
        habits: state.habits.map((h) => (h.id === id ? updated : h)),
      }));
    } catch (err) {
      if (isOfflineQueued(err)) {
        set((state) => ({ habits: state.habits.map((h) => (h.id === id ? { ...h, ...data } : h)) }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при обновлении привычки';
      throw new Error(msg);
    }
  },

  deleteHabit: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/habits/${id}`, token, QUEUE_OFFLINE);
      set((state) => ({
        habits: state.habits.filter((h) => h.id !== id),
      }));
    } catch (err) {
      if (isOfflineQueued(err)) {
        set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении привычки';
      throw new Error(msg);
    }
  },

  toggleHabitLog: async (habitId: string, date: string, completed: boolean) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const putLog = (log: HabitLog) =>
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
    try {
      putLog(await api.post<HabitLog>(`/habits/${habitId}/log`, { date, completed }, token, QUEUE_OFFLINE));
      if (completed) useRobotReactionStore.getState().react('happy');
    } catch (err) {
      // Без сети отметка в очереди — показываем её сразу.
      if (isOfflineQueued(err)) {
        putLog({ id: offlineId(), habitId, userId: '', date, completed, autoCompleted: false });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при отметке привычки';
      throw new Error(msg);
    }
  },

  fetchLogs: async (from: string, to: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const rows = await api.get<ServerHabitLog[]>(`/habits/logs?from=${from}&to=${to}`, token);
      const byDate: Record<string, HabitLog[]> = {};
      for (const day of datesInRange(from, to)) byDate[day] = [];
      for (const r of rows) {
        (byDate[r.date] ??= []).push({
          id: r.id,
          habitId: r.habitId,
          userId: '',
          date: r.date,
          completed: r.completed,
          autoCompleted: false,
        });
      }
      // Сервер — источник правды за весь диапазон (включая снятые отметки).
      set((state) => ({ logs: { ...state.logs, ...byDate } }));
    } catch (err) {
      // Сеть упала — оставляем локальные отметки как есть.
      console.warn('fetchLogs failed', err);
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
