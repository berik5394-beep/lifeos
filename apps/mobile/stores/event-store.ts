import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { surfaceCreateWarnings } from '@/services/create-warnings';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import type { RescheduleProposal } from '@/stores/schedule-store';

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  reminder: number;
  source: string;
  createdAt: string;
}

interface CreateEventData {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  reminder?: number;
  source?: string;
}

interface CreateEventResponse {
  event: CalendarEvent;
  conflicts: CalendarEvent[];
}

interface EventState {
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
  isLoading: boolean;
  fetchEvents: (params?: { date?: string; week?: string; month?: string }) => Promise<void>;
  fetchUpcoming: () => Promise<void>;
  createEvent: (data: CreateEventData) => Promise<CreateEventResponse>;
  updateEvent: (id: string, data: Partial<CreateEventData>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
}

export const useEventStore = create<EventState>((set) => ({
  events: [],
  upcoming: [],
  isLoading: false,

  fetchEvents: async (params) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const query = new URLSearchParams();
      if (params?.date) query.set('date', params.date);
      if (params?.week) query.set('week', params.week);
      if (params?.month) query.set('month', params.month);
      const qs = query.toString();
      const events = await api.get<CalendarEvent[]>(`/events${qs ? `?${qs}` : ''}`, token);
      set({ events, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchUpcoming: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const upcoming = await api.get<CalendarEvent[]>('/events/upcoming', token);
      set({ upcoming, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  createEvent: async (data) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Не авторизован');

    // Сервер отдаёт саму встречу (+ conflicts/proposal), а не { event } —
    // раньше в список попадал undefined.
    const { conflicts = [], proposal, conflictWarning, ...event } = await api.post<
      CalendarEvent & { conflicts?: CalendarEvent[]; proposal?: RescheduleProposal; conflictWarning?: string }
    >('/events', data, token);
    set((state) => ({ events: [event, ...state.events] }));
    // Перегруз дня (встреча съела время) и наложение по времени — одним облачком.
    surfaceCreateWarnings(proposal, conflictWarning);
    return { event, conflicts };
  },

  updateEvent: async (id, data) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const { proposal, conflicts: _conflicts, conflictWarning, ...updated } = await api.put<
      CalendarEvent & { conflicts?: CalendarEvent[]; proposal?: RescheduleProposal; conflictWarning?: string }
    >(`/events/${id}`, data, token);
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? updated : e)),
    }));
    // Перегруз дня и наложение по новому времени (или «в Google не обновилась») — одним облачком.
    surfaceCreateWarnings(proposal, conflictWarning);
  },

  deleteEvent: async (id) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const res = await api.delete<{ success: boolean; warning?: string }>(`/events/${id}`, token);
    // «В Google не удалилась — убери там» — честно облачком.
    if (res?.warning) useRobotReactionStore.getState().react('worried', res.warning);
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
      upcoming: state.upcoming.filter((e) => e.id !== id),
    }));
  },
}));
