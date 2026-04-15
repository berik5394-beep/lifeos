import { api } from '@/services/api';
import { useTaskStore } from '@/stores/task-store';

const mockedApi = api as jest.Mocked<typeof api>;

const MOCK_TASK = {
  id: 'task-1',
  userId: 'user-1',
  title: 'Test task',
  category: 'work',
  priority: 'medium',
  date: '2026-04-13',
  time: null,
  completed: false,
  notes: null,
  createdAt: '2026-04-13T00:00:00Z',
};

const MOCK_TASK_2 = {
  ...MOCK_TASK,
  id: 'task-2',
  title: 'Second task',
};

beforeEach(() => {
  useTaskStore.setState({ tasks: [], isLoading: false });
  jest.clearAllMocks();
});

describe('useTaskStore', () => {
  it('has empty tasks array as initial state', () => {
    const state = useTaskStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  describe('fetchTasks', () => {
    it('sets tasks from API response', async () => {
      mockedApi.get.mockResolvedValueOnce([MOCK_TASK, MOCK_TASK_2]);

      await useTaskStore.getState().fetchTasks('2026-04-13');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(2);
      expect(state.tasks[0].title).toBe('Test task');
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading during fetch', async () => {
      let resolvePromise: (v: unknown) => void;
      const promise = new Promise((resolve) => { resolvePromise = resolve; });
      mockedApi.get.mockReturnValueOnce(promise as Promise<never>);

      const fetchPromise = useTaskStore.getState().fetchTasks();
      expect(useTaskStore.getState().isLoading).toBe(true);

      resolvePromise!([]);
      await fetchPromise;
      expect(useTaskStore.getState().isLoading).toBe(false);
    });
  });

  describe('createTask', () => {
    it('adds a task to the list', async () => {
      mockedApi.post.mockResolvedValueOnce(MOCK_TASK);

      await useTaskStore.getState().createTask({
        title: 'Test task',
        category: 'work',
        priority: 'medium',
        date: '2026-04-13',
      });

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('task-1');
    });
  });

  describe('deleteTask', () => {
    it('removes a task from the list', async () => {
      useTaskStore.setState({ tasks: [MOCK_TASK, MOCK_TASK_2] });
      mockedApi.delete.mockResolvedValueOnce(undefined);

      await useTaskStore.getState().deleteTask('task-1');

      const tasks = useTaskStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-2');
    });
  });

  describe('toggleComplete', () => {
    it('optimistically toggles the completed field', async () => {
      useTaskStore.setState({ tasks: [MOCK_TASK] });
      mockedApi.patch.mockResolvedValueOnce({ ...MOCK_TASK, completed: true });

      await useTaskStore.getState().toggleComplete('task-1');

      expect(useTaskStore.getState().tasks[0].completed).toBe(true);
    });

    it('reverts on API error', async () => {
      useTaskStore.setState({ tasks: [MOCK_TASK] });
      mockedApi.patch.mockRejectedValueOnce(new Error('Network error'));

      await useTaskStore.getState().toggleComplete('task-1');

      // Should revert back to original (false)
      expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });
  });

  describe('updateKanbanStatus', () => {
    it('changes kanban status optimistically', async () => {
      const taskWithKanban = { ...MOCK_TASK, kanbanStatus: 'todo' };
      useTaskStore.setState({ tasks: [taskWithKanban] });
      mockedApi.patch.mockResolvedValueOnce({ ...taskWithKanban, kanbanStatus: 'in_progress' });

      await useTaskStore.getState().updateKanbanStatus('task-1', 'in_progress');

      expect(useTaskStore.getState().tasks[0].kanbanStatus).toBe('in_progress');
    });
  });
});
