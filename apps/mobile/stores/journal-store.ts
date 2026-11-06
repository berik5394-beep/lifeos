import { create } from 'zustand';
import { api, isOfflineQueued, QUEUE_OFFLINE } from '@/services/api';
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
  /** Бросает ошибку, если не сохранилось (без сети — сохраняет локально и ставит в очередь). */
  saveEntry: (data: SaveEntryData) => Promise<void>;
  /** После отправки офлайн-очереди — перечитать сегодняшнюю запись. */
  refreshAfterSync: () => void;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Сервер отдаёт дату ISO-строкой («2026-11-06T00:00:00.000Z») — сравниваем по дню. */
const dayOf = (date: string): string => date.slice(0, 10);

/** Положить запись дня в список (заменив прежнюю за этот день) и в «сегодня», если она сегодняшняя. */
function upsert(state: JournalState, entry: JournalEntry): Partial<JournalState> {
  const day = dayOf(entry.date);
  const normalized = { ...entry, date: day };
  const exists = state.entries.some((e) => dayOf(e.date) === day);
  return {
    entries: exists
      ? state.entries.map((e) => (dayOf(e.date) === day ? normalized : e))
      : [...state.entries, normalized],
    todayEntry: day === getTodayDate() ? normalized : state.todayEntry,
  };
}

export const useJournalStore = create<JournalState>((set, get) => ({
  todayEntry: null,
  entries: [],
  isLoading: false,

  // Любой день, не только сегодня: раньше прошлые дни в дневнике открывались пустыми.
  fetchEntry: async (date: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const entry = await api.get<JournalEntry>(`/journal/${date}`, token);
      set((state) => ({ ...upsert(state, { ...entry, date }), isLoading: false }));
    } catch {
      // Нет сети и кэша — оставляем то, что уже знаем.
      set({ isLoading: false });
    }
  },

  fetchMonthEntries: async (month: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const entries = await api.get<JournalEntry[]>(`/journal?month=${month}`, token);
      set({ entries: entries.map((e) => ({ ...e, date: dayOf(e.date) })), isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  saveEntry: async (data: SaveEntryData) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Войди в аккаунт, чтобы сохранить запись.');

    set({ isLoading: true });
    try {
      const entry = await api.post<JournalEntry>('/journal', data, token, QUEUE_OFFLINE);
      set((state) => ({ ...upsert(state, entry), isLoading: false }));
    } catch (err) {
      if (isOfflineQueued(err)) {
        // Без сети: запись в очереди — показываем сохранённое сразу (поверх прежнего за этот день).
        const prev = get().entries.find((e) => dayOf(e.date) === dayOf(data.date));
        const local: JournalEntry = {
          date: dayOf(data.date),
          sleepHours: data.sleepHours !== undefined ? data.sleepHours : prev?.sleepHours ?? null,
          energy: data.energy !== undefined ? data.energy : prev?.energy ?? null,
          mood: data.mood !== undefined ? data.mood : prev?.mood ?? null,
          notes: data.notes !== undefined ? data.notes : prev?.notes ?? null,
        };
        set((state) => ({ ...upsert(state, local), isLoading: false }));
        return;
      }
      set({ isLoading: false });
      // Раньше ошибка глоталась, а экран писал «Запись сохранена».
      throw err instanceof Error ? err : new Error('Не удалось сохранить запись');
    }
  },

  refreshAfterSync: () => {
    get().fetchEntry(getTodayDate()).catch(() => {});
  },
}));
