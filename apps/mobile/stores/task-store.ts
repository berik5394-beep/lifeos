import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { persistStoreData, restoreStoreData } from '@/services/store-persist';

interface TaskTag {
  id: string;
  tag: { id: string; name: string; color: string };
}

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
  parentId?: string | null;
  subtasks?: Task[];
  kanbanStatus?: string;
  estimatedMinutes?: number | null;
  recurrence?: string | null;
  urgency?: number | null;
  importance?: number | null;
  aiScore?: number | null;
  sharedSpaceId?: string | null;
  taskTags?: TaskTag[];
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
  fetchTasks: (date?: string, week?: string, month?: string) => Promise<void>;
  createTask: (data: CreateTaskData) => Promise<void>;
  updateTask: (id: string, data: UpdateTaskData) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  quickAdd: (text: string) => Promise<void>;
  updateKanbanStatus: (taskId: string, status: string) => Promise<void>;
  runAIPrioritization: () => Promise<void>;
  addDependency: (taskId: string, prerequisiteId: string) => Promise<void>;
  removeDependency: (taskId: string, depId: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  isLoading: false,

  fetchTasks: async (date?: string, week?: string, month?: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (week) params.set('week', week);
      if (month) params.set('month', month);
      const query = params.toString();
      const endpoint = `/tasks${query ? `?${query}` : ''}`;
      const tasks = await api.get<Task[]>(endpoint, token);
      set({ tasks, isLoading: false });
      persistStoreData('tasks', tasks).catch(() => {});
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  createTask: async (data: CreateTaskData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const task = await api.post<Task>('/tasks', data, token);
      set((state) => ({ tasks: [...state.tasks, task] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при создании задачи';
      throw new Error(msg);
    }
  },

  updateTask: async (id: string, data: UpdateTaskData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const updated = await api.put<Task>(`/tasks/${id}`, data, token);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при обновлении задачи';
      throw new Error(msg);
    }
  },

  deleteTask: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/tasks/${id}`, token);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении задачи';
      throw new Error(msg);
    }
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

  quickAdd: async (text: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const task = await api.post<Task>('/tasks/quick-add', { text }, token);
      set((state) => ({ tasks: [...state.tasks, task] }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при быстром добавлении';
      throw new Error(msg);
    }
  },

  updateKanbanStatus: async (taskId: string, status: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    // Optimistic update
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, kanbanStatus: status } : t,
      ),
    }));

    try {
      const updated = await api.patch<Task>(`/tasks/${taskId}/kanban`, { status }, token);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
    } catch {
      // Revert on error — refetch to restore correct state
      get().fetchTasks().catch(() => {});
    }
  },

  runAIPrioritization: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const prioritized = await api.post<Task[]>('/tasks/ai-prioritize', {}, token);
      set({ tasks: prioritized });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка AI-приоритизации';
      throw new Error(msg);
    }
  },

  addDependency: async (taskId: string, prerequisiteId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.post(`/tasks/${taskId}/dependencies`, { prerequisiteId }, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при добавлении зависимости';
      throw new Error(msg);
    }
  },

  removeDependency: async (taskId: string, depId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      await api.delete(`/tasks/${taskId}/dependencies/${depId}`, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка при удалении зависимости';
      throw new Error(msg);
    }
  },
}));
