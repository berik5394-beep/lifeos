import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

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

    const response = await api.post<CreateEventResponse>('/events', data, token);
    set((state) => ({ events: [response.event, ...state.events] }));
    return response;
  },

  updateEvent: async (id, data) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const updated = await api.put<CalendarEvent>(`/events/${id}`, data, token);
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? updated : e)),
    }));
  },

  deleteEvent: async (id) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/events/${id}`, token);
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
      upcoming: state.upcoming.filter((e) => e.id !== id),
    }));
  },
}));
