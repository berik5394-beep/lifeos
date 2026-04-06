import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface GpsPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface StepLog {
  id?: string;
  userId?: string;
  date: string;
  steps: number;
  distanceKm: number | null;
  gpsTrack: GpsPoint[] | null;
}

interface StepState {
  todaySteps: number;
  todayDistance: number | null;
  weekLogs: StepLog[];
  gpsTrack: GpsPoint[];
  isTracking: boolean;
  fetchToday: (date: string) => Promise<void>;
  fetchWeek: (weekStart: string) => Promise<void>;
  saveSteps: (data: {
    date: string;
    steps: number;
    distanceKm?: number;
    gpsTrack?: GpsPoint[];
  }) => Promise<void>;
  addGpsPoint: (point: GpsPoint) => void;
  setTodaySteps: (steps: number) => void;
  startTracking: () => void;
  stopTracking: () => void;
  clearGpsTrack: () => void;
}

export const useStepStore = create<StepState>((set, get) => ({
  todaySteps: 0,
  todayDistance: null,
  weekLogs: [],
  gpsTrack: [],
  isTracking: false,

  fetchToday: async (date: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.get<StepLog>(`/steps?date=${date}`, token);
      set({
        todaySteps: data.steps,
        todayDistance: data.distanceKm,
        gpsTrack: data.gpsTrack ?? [],
      });
    } catch {
      // No data for today yet
    }
  },

  fetchWeek: async (weekStart: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.get<StepLog[]>(`/steps?week=${weekStart}`, token);
      set({ weekLogs: data });
    } catch {
      set({ weekLogs: [] });
    }
  },

  saveSteps: async (data) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      await api.post('/steps', data, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения шагов';
      throw new Error(message);
    }
  },

  addGpsPoint: (point: GpsPoint) => {
    set((state) => ({
      gpsTrack: [...state.gpsTrack, point],
    }));
  },

  setTodaySteps: (steps: number) => {
    set({ todaySteps: steps });
  },

  startTracking: () => {
    set({ isTracking: true });
  },

  stopTracking: () => {
    set({ isTracking: false });
  },

  clearGpsTrack: () => {
    set({ gpsTrack: [] });
  },
}));
