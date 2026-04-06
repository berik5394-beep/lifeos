import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface Task {
  id: string;
  userId: string;
  title: string;
  category: string;
  priority: string;
  date: string;
  time: string | null;
  completed: boolean;
  notes: string | null;
  createdAt: string;
}

interface CreateTaskData {
  title: string;
  category: string;
  priority: string;
  date: string;
  time?: string;
  notes?: string;
}

interface UpdateTaskData {
  title?: string;
  category?: string;
  priority?: string;
  date?: string;
  time?: string | null;
  notes?: string | null;
  completed?: boolean;
}

interface TaskState {
  tasks: Task[];
  isLoading: boolean;
  fetchTasks: (date?: string, week?: string) => Promise<void>;
  createTask: (data: CreateTaskData) => Promise<void>;
  updateTask: (id: string, data: UpdateTaskData) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoading: false,

  fetchTasks: async (date?: string, week?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (week) params.set('week', week);
      const query = params.toString();
      const endpoint = `/tasks${query ? `?${query}` : ''}`;
      const tasks = await api.get<Task[]>(endpoint, token);
      set({ tasks, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createTask: async (data: CreateTaskData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const task = await api.post<Task>('/tasks', data, token);
    set((state) => ({ tasks: [...state.tasks, task] }));
  },

  updateTask: async (id: string, data: UpdateTaskData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const updated = await api.put<Task>(`/tasks/${id}`, data, token);
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTask: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await api.delete(`/tasks/${id}`, token);
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
  },

  toggleComplete: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    // Optimistic update
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t,
      ),
    }));

    try {
      const updated = await api.patch<Task>(`/tasks/${id}/complete`, {}, token);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch {
      // Revert on error
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, completed: task.completed } : t,
        ),
      }));
    }
  },
}));
