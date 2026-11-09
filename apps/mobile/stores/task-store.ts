import { create } from 'zustand';
import { api, ApiError, isOfflineQueued, QUEUE_OFFLINE } from '@/services/api';
import { offlineId } from '@/utils/offline-id';
import { formatDate } from '@/utils/dates';
import { useAuthStore } from '@/stores/auth-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import { surfaceCreateWarnings } from '@/services/create-warnings';
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
  /** Колонка канбана (по умолчанию «К выполнению»). */
  kanbanStatus?: string;
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

/** Диапазон дат [from, to) запроса GET /tasks (как на сервере); без параметров — всё. */
export function fetchRange(date?: string, week?: string, month?: string): { from: string; to: string } | null {
  const plus = (ymd: string, days: number) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  if (week) return { from: week.slice(0, 10), to: plus(week.slice(0, 10), 7) };
  if (date) return { from: date.slice(0, 10), to: plus(date.slice(0, 10), 1) };
  if (month) {
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
  }
  return null;
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
      const fetched = await api.get<Task[]>(endpoint, token);
      // Стор общий для экранов с разными выборками («Сегодня» — неделя,
      // календарь — месяц, канбан — всё). Раньше ответ целиком ЗАМЕНЯЛ стор —
      // побеждал последний, и «Все задачи недели» показывали месяц (аудит
      // 2026-11-09). Теперь меняем только задачи внутри запрошенного диапазона.
      const range = fetchRange(date, week, month);
      const tasks = range
        ? [
            ...get().tasks.filter((t) => {
              const d = t.date.slice(0, 10);
              return d < range.from || d >= range.to;
            }),
            ...fetched,
          ]
        : fetched;
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

    const localId = offlineId();
    try {
      const { proposal, conflictWarning, ...task } = await api.post<
        Task & { proposal?: RescheduleProposal; conflictWarning?: string }
      >('/tasks', data, token, { ...QUEUE_OFFLINE, localId });
      set((state) => ({ tasks: [...state.tasks, task] }));
      // Перегруз дня (облачко + «Подтвердить») и наложение по времени — одним облачком.
      surfaceCreateWarnings(proposal, conflictWarning);
    } catch (err) {
      // Без сети: запись в очереди — показываем задачу сразу, после отправки
      // список перечитается и временный id сменится настоящим.
      if (isOfflineQueued(err)) {
        const local: Task = {
          id: localId,
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
      const { proposal, conflictWarning, ...updated } = await api.put<
        Task & { proposal?: RescheduleProposal; conflictWarning?: string }
      >(`/tasks/${id}`, data, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
      // Перенос поверх встречи / перегруз нового дня — одним облачком.
      surfaceCreateWarnings(proposal, conflictWarning);
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
        t.id === id
          ? {
              ...t,
              completed: !t.completed,
              // Галочка ⇄ «Готово» канбана (то же правило, что на сервере).
              kanbanStatus: !t.completed ? 'done' : t.kanbanStatus === 'done' ? 'todo' : t.kanbanStatus,
            }
          : t,
      ),
    }));

    try {
      // Желаемое состояние, а не «переключи»: повтор из офлайн-очереди не снимет галочку.
      const updated = await api.patch<Task>(`/tasks/${id}/complete`, { completed: !task.completed }, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
      if (updated.completed) useRobotReactionStore.getState().react('happy');
    } catch (err) {
      // Без сети отметка в очереди — оставляем как отметил.
      if (isOfflineQueued(err)) return;
      // Revert on error
      set((state) => ({
        tasks: state.tasks.map((t) =>
          // Откат целиком (и колонки канбана — раньше карточка уезжала в «К выполнению»).
          t.id === id ? { ...t, completed: task.completed, kanbanStatus: task.kanbanStatus } : t,
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
      const res = await api.post<{ task: Task; proposal?: RescheduleProposal; conflictWarning?: string }>(
        '/tasks/quick-add',
        { text },
        token,
      );
      set((state) => ({ tasks: [...state.tasks, res.task] }));
      // «позвонить завтра в 10:30» поверх встречи + перегруз дня — одним облачком.
      surfaceCreateWarnings(res.proposal, res.conflictWarning);
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
        // «Готово» = выполнена (как на сервере); уход из «Готово» снимает отметку.
        t.id === taskId ? { ...t, kanbanStatus: status, completed: status === 'done' } : t,
      ),
    }));

    try {
      const updated = await api.patch<Task>(`/tasks/${taskId}/kanban`, { status }, token, QUEUE_OFFLINE);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
      // «Готово» в канбане = выполнена — робот радуется, как на галочку.
      if (status === 'done' && updated.completed) useRobotReactionStore.getState().react('happy');
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
      // Путь на сервере — /tasks/prioritize (раньше /tasks/ai-prioritize → 404).
      // Ответ: массив невыполненных с оценками ИЛИ { tasks: [] }, если их нет.
      // Оценки вливаем в стор, а не заменяем им список: иначе выполненные
      // задачи пропадали бы с экранов.
      const res = await api.post<Task[] | { tasks: Task[] }>('/tasks/prioritize', {}, token);
      const scored = Array.isArray(res) ? res : res.tasks ?? [];
      const byId = new Map(scored.map((t) => [t.id, t]));
      set((state) => ({
        tasks: state.tasks.map((t) => {
          const s = byId.get(t.id);
          return s ? { ...t, urgency: s.urgency, importance: s.importance, aiScore: s.aiScore } : t;
        }),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка AI-приоритизации';
      throw new Error(msg);
    }
  },

  addDependency: async (taskId: string, prerequisiteId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      // Сервер ждёт prerequisiteTaskId (раньше слали prerequisiteId → 400 всегда).
      await api.post(`/tasks/${taskId}/dependencies`, { prerequisiteTaskId: prerequisiteId }, token);
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
