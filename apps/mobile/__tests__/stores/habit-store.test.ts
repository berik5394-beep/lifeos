import { api } from '@/services/api';
import { useHabitStore } from '@/stores/habit-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';

const mockedApi = api as jest.Mocked<typeof api>;

const MOCK_HABIT = {
  id: 'habit-1',
  userId: 'user-1',
  name: 'Morning workout',
  category: 'health',
  frequency: 'daily',
  goalId: null,
  order: 0,
  active: true,
  createdAt: '2026-04-01T00:00:00Z',
};

const MOCK_HABIT_2 = {
  ...MOCK_HABIT,
  id: 'habit-2',
  name: 'Read 30 pages',
  category: 'personal',
};

const MOCK_LOG = {
  id: 'log-1',
  habitId: 'habit-1',
  userId: 'user-1',
  date: '2026-04-13',
  completed: true,
  autoCompleted: false,
};

beforeEach(() => {
  useHabitStore.setState({ habits: [], logs: {}, stats: [], isLoading: false });
  jest.clearAllMocks();
});

describe('useHabitStore', () => {
  it('has correct initial state', () => {
    const state = useHabitStore.getState();
    expect(state.habits).toEqual([]);
    expect(state.logs).toEqual({});
    expect(state.stats).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  describe('fetchHabits', () => {
    it('populates habits from API', async () => {
      mockedApi.get.mockResolvedValueOnce([MOCK_HABIT, MOCK_HABIT_2]);

      await useHabitStore.getState().fetchHabits();

      const state = useHabitStore.getState();
      expect(state.habits).toHaveLength(2);
      expect(state.habits[0].name).toBe('Morning workout');
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading true during fetch', async () => {
      let resolvePromise: (v: unknown) => void;
      const promise = new Promise((resolve) => { resolvePromise = resolve; });
      mockedApi.get.mockReturnValueOnce(promise as Promise<never>);

      const fetchPromise = useHabitStore.getState().fetchHabits();
      expect(useHabitStore.getState().isLoading).toBe(true);

      resolvePromise!([]);
      await fetchPromise;
      expect(useHabitStore.getState().isLoading).toBe(false);
    });
  });

  describe('createHabit', () => {
    it('adds a habit to the list', async () => {
      mockedApi.post.mockResolvedValueOnce(MOCK_HABIT);

      await useHabitStore.getState().createHabit({
        name: 'Morning workout',
        category: 'health',
        frequency: 'daily',
      });

      expect(useHabitStore.getState().habits).toHaveLength(1);
      expect(useHabitStore.getState().habits[0].id).toBe('habit-1');
    });

    it('throws on API error', async () => {
      mockedApi.post.mockRejectedValueOnce(new Error('Server error'));

      await expect(
        useHabitStore.getState().createHabit({
          name: 'Test',
          category: 'health',
          frequency: 'daily',
        }),
      ).rejects.toThrow();
    });
  });

  describe('deleteHabit', () => {
    it('removes habit from list', async () => {
      useHabitStore.setState({ habits: [MOCK_HABIT, MOCK_HABIT_2] });
      mockedApi.delete.mockResolvedValueOnce(undefined);

      await useHabitStore.getState().deleteHabit('habit-1');

      const habits = useHabitStore.getState().habits;
      expect(habits).toHaveLength(1);
      expect(habits[0].id).toBe('habit-2');
    });
  });

  describe('toggleHabitLog', () => {
    it('creates a log entry for a date', async () => {
      mockedApi.post.mockResolvedValueOnce(MOCK_LOG);

      await useHabitStore.getState().toggleHabitLog('habit-1', '2026-04-13', true);

      const logs = useHabitStore.getState().logs;
      expect(logs['2026-04-13']).toHaveLength(1);
      expect(logs['2026-04-13'][0].completed).toBe(true);
    });

    it('updates an existing log for the same habit and date', async () => {
      useHabitStore.setState({
        logs: { '2026-04-13': [MOCK_LOG] },
      });

      const updatedLog = { ...MOCK_LOG, completed: false };
      mockedApi.post.mockResolvedValueOnce(updatedLog);

      await useHabitStore.getState().toggleHabitLog('habit-1', '2026-04-13', false);

      const logs = useHabitStore.getState().logs;
      expect(logs['2026-04-13']).toHaveLength(1);
      expect(logs['2026-04-13'][0].completed).toBe(false);
    });

    it('шаг к цели с сервера → облачко робота, в лог не попадает', async () => {
      useHabitStore.setState({ logs: {} });
      mockedApi.post.mockResolvedValueOnce({ ...MOCK_LOG, reaction: '«Бег» — шаг к цели «Марафон».' });

      await useHabitStore.getState().toggleHabitLog('habit-1', '2026-04-13', true);

      expect(useRobotReactionStore.getState().reaction).toMatchObject({ emotion: 'happy', text: '«Бег» — шаг к цели «Марафон».' });
      expect(useHabitStore.getState().logs['2026-04-13'][0]).not.toHaveProperty('reaction');
    });
  });
});

describe('fetchLogs — отметки с сервера (habit-day)', () => {
  it('раскладывает по датам, заменяет весь диапазон, не трогает даты вне диапазона', async () => {
    useHabitStore.setState({
      logs: {
        '2026-11-03': [{ ...MOCK_LOG, id: 'stale', date: '2026-11-03' }], // снята на другом устройстве → должна уйти
        '2026-10-01': [{ ...MOCK_LOG, id: 'outside', date: '2026-10-01' }], // вне диапазона → остаётся
      },
    });
    mockedApi.get.mockResolvedValueOnce([
      { id: 'a', habitId: 'habit-1', date: '2026-11-04', completed: true },
      { id: 'b', habitId: 'habit-2', date: '2026-11-04', completed: true },
      { id: 'c', habitId: 'habit-1', date: '2026-11-05', completed: true },
    ]);
    await useHabitStore.getState().fetchLogs('2026-11-03', '2026-11-05');
    expect(mockedApi.get).toHaveBeenCalledWith('/habits/logs?from=2026-11-03&to=2026-11-05', 'test-token-123');
    const logs = useHabitStore.getState().logs;
    expect(logs['2026-11-03']).toEqual([]);
    expect(logs['2026-11-04'].map((l) => l.habitId)).toEqual(['habit-1', 'habit-2']);
    expect(logs['2026-11-05']).toHaveLength(1);
    expect(logs['2026-10-01'][0].id).toBe('outside');
  });

  it('сбой сети — локальные отметки не стираются', async () => {
    useHabitStore.setState({ logs: { '2026-11-05': [{ ...MOCK_LOG, date: '2026-11-05' }] } });
    mockedApi.get.mockRejectedValueOnce(new Error('network'));
    await useHabitStore.getState().fetchLogs('2026-11-05', '2026-11-05');
    expect(useHabitStore.getState().logs['2026-11-05']).toHaveLength(1);
  });
});
