import { create } from 'zustand';
import { api, ApiError, isOfflineQueued, QUEUE_OFFLINE } from '@/services/api';
import { offlineId } from '@/utils/offline-id';
import { formatDate } from '@/utils/dates';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import type { RescheduleProposal } from '@/stores/schedule-store';
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
      const { proposal, ...task } = await api.post<Task & { proposal?: RescheduleProposal }>('/tasks', data, token, QUEUE_OFFLINE);
      set((state) => ({ tasks: [...state.tasks, task] }));
      // Перегруз дня: робот предлагает сдвинуть график (облачко + «Подтвердить»).
      if (proposal) useChatStore.getState().showProposal(proposal);
    } catch (err) {
      // Без сети: запись в очереди — показываем задачу сразу, после отправки
      // список перечитается и временный id сменится настоящим.
      if (isOfflineQueued(err)) {
        const local: Task = {
          id: offlineId(),
          userId: '',
          title: data.title,
          category: data.category,
          priority: data.priority,
          date: data.date,
          time: data.time ?? null,
          completed: false,
          notes: data.notes ?? null,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ tasks: [...state.tasks, local] }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при создании задачи';
      throw new Error(msg);
    }
  },

  updateTask: async (id: string, data: UpdateTaskData) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const { proposal, ...updated } = await api.put<Task & { proposal?: RescheduleProposal }>(`/tasks/${id}`, data, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
      if (proposal) useChatStore.getState().showProposal(proposal);
    } catch (err) {
      if (isOfflineQueued(err)) {
        set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...data } : t)) }));
        return;
      }
      const msg = err instanceof Error ? err.message : 'Ошибка при обновлении задачи';
      throw new Error(msg);
    }
  },

  deleteTask: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    // Удалённая задача не должна звенеть: снимаем её напоминание и будильник.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cancelTaskReminders } = require('@/services/task-reminders') as typeof import('@/services/task-reminders');
      cancelTaskReminders(id).catch(() => {});
    } catch {
      /* уведомления недоступны — не мешаем удалению */
    }

    try {
      await api.delete(`/tasks/${id}`, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      }));
    } catch (err) {
      if (isOfflineQueued(err)) {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
        return;
      }
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
      const updated = await api.patch<Task>(`/tasks/${id}/complete`, {}, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (err) {
      // Без сети отметка в очереди — оставляем как отметил.
      if (isOfflineQueued(err)) return;
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
      // Сервер отдаёт { task, parsed, confidence, proposal? } — раньше в список
      // попадала вся обёртка вместо задачи.
      const res = await api.post<{ task: Task; proposal?: RescheduleProposal }>('/tasks/quick-add', { text }, token);
      set((state) => ({ tasks: [...state.tasks, res.task] }));
      if (res.proposal) useChatStore.getState().showProposal(res.proposal);
    } catch (err) {
      // Разбор фразы (ИИ) не сработал или нет сети — задачу не теряем: пишем как
      // есть, на сегодня (без сети — в очередь, видна сразу).
      // Нет доступа (401) или лимит (429) — честная ошибка, обход не поможет.
      const status = err instanceof ApiError ? err.status : -1;
      if (status >= 500 || status === 400 || status === 422 || status === 0) {
        await get().createTask({ title: text.trim(), category: 'personal', priority: 'medium', date: formatDate(new Date()) });
        return;
      }
      throw new Error(status === 429 && err instanceof Error ? err.message : 'Не получилось добавить задачу. Попробуй ещё раз.');
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
      const updated = await api.patch<Task>(`/tasks/${taskId}/kanban`, { status }, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
    } catch (err) {
      if (isOfflineQueued(err)) return;
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
