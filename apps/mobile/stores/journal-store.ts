import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface JournalEntry {
  id?: string;
  userId?: string;
  date: string;
  sleepHours: number | null;
  energy: number | null;
  mood: number | null;
  notes: string | null;
}

interface SaveEntryData {
  date: string;
  sleepHours?: number | null;
  energy?: number | null;
  mood?: number | null;
  notes?: string | null;
}

interface JournalState {
  todayEntry: JournalEntry | null;
  entries: JournalEntry[];
  isLoading: boolean;
  fetchEntry: (date: string) => Promise<void>;
  fetchMonthEntries: (month: string) => Promise<void>;
  saveEntry: (data: SaveEntryData) => Promise<void>;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const useJournalStore = create<JournalState>((set) => ({
  todayEntry: null,
  entries: [],
  isLoading: false,

  fetchEntry: async (date: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const entry = await api.get<JournalEntry>(`/journal/${date}`, token);
      const today = getTodayDate();

      set((state) => ({
        todayEntry: date === today ? entry : state.todayEntry,
        isLoading: false,
      }));
    } catch {
      set({ todayEntry: null, isLoading: false });
    }
  },

  fetchMonthEntries: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const entries = await api.get<JournalEntry[]>(`/journal?month=${month}`, token);
      set({ entries, isLoading: false });
    } catch {
      set({ entries: [], isLoading: false });
    }
  },

  saveEntry: async (data: SaveEntryData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const entry = await api.post<JournalEntry>('/journal', data, token);
      const today = getTodayDate();

      set((state) => {
        const existingIndex = state.entries.findIndex((e) => e.date === entry.date);
        const updatedEntries =
          existingIndex >= 0
            ? state.entries.map((e, i) => (i === existingIndex ? entry : e))
            : [...state.entries, entry];

        return {
          entries: updatedEntries,
          todayEntry: entry.date === today ? entry : state.todayEntry,
          isLoading: false,
        };
      });
    } catch {
      set({ isLoading: false });
    }
  },
}));
