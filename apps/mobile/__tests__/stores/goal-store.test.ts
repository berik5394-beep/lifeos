import { api } from '@/services/api';
import { useGoalStore } from '@/stores/goal-store';

const mockApi = api as jest.Mocked<typeof api>;

const MOCK_WEEKLY_GOAL = {
  id: 'wg-1',
  userId: 'user-1',
  weekStart: '2026-04-13',
  goalText: 'Закрыть все задачи',
  completed: false,
  order: 0,
};

const MOCK_WEEKLY_GOAL_2 = {
  ...MOCK_WEEKLY_GOAL,
  id: 'wg-2',
  goalText: 'Пробежать 30 км',
  order: 1,
};

const MOCK_YEARLY_GOAL = {
  id: 'yg-1',
  userId: 'user-1',
  year: 2026,
  area: 'finance',
  goalText: 'Накопить 1 000 000 ₸',
  progress: 0.35,
};

const MOCK_YEARLY_GOAL_2 = {
  ...MOCK_YEARLY_GOAL,
  id: 'yg-2',
  area: 'health',
  goalText: 'Пробежать марафон',
  progress: 0.1,
};

const INITIAL_STATE = {
  weeklyGoals: [],
  yearlyGoals: [],
  isLoading: false,
};

beforeEach(() => {
  useGoalStore.setState(INITIAL_STATE);
  jest.clearAllMocks();
});

describe('useGoalStore', () => {
  it('has correct initial state', () => {
    const state = useGoalStore.getState();
    expect(state.weeklyGoals).toEqual([]);
    expect(state.yearlyGoals).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  describe('fetchYearlyGoals', () => {
    it('fetches yearly goals with year param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_YEARLY_GOAL, MOCK_YEARLY_GOAL_2]);

      await useGoalStore.getState().fetchYearlyGoals(2026);

      expect(mockApi.get).toHaveBeenCalledWith('/goals/yearly?year=2026', 'test-token-123');
      expect(useGoalStore.getState().yearlyGoals).toHaveLength(2);
      expect(useGoalStore.getState().isLoading).toBe(false);
    });

    it('fetches yearly goals without year param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_YEARLY_GOAL]);

      await useGoalStore.getState().fetchYearlyGoals();

      expect(mockApi.get).toHaveBeenCalledWith('/goals/yearly', 'test-token-123');
    });

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void;
      const promise = new Promise((r) => { resolve = r; });
      mockApi.get.mockReturnValueOnce(promise as Promise<never>);

      const fetchPromise = useGoalStore.getState().fetchYearlyGoals(2026);
      expect(useGoalStore.getState().isLoading).toBe(true);

      resolve!([]);
      await fetchPromise;
      expect(useGoalStore.getState().isLoading).toBe(false);
    });

    it('rethrows API error and resets loading', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Server error'));

      await expect(useGoalStore.getState().fetchYearlyGoals(2026)).rejects.toThrow('Server error');
      expect(useGoalStore.getState().isLoading).toBe(false);
    });
  });

  describe('createYearlyGoal', () => {
    it('creates and appends a yearly goal', async () => {
      mockApi.post.mockResolvedValueOnce(MOCK_YEARLY_GOAL);

      await useGoalStore.getState().createYearlyGoal({
        year: 2026,
        area: 'finance',
        goalText: 'Накопить 1 000 000 ₸',
      });

      expect(mockApi.post).toHaveBeenCalledWith(
        '/goals/yearly',
        { year: 2026, area: 'finance', goalText: 'Накопить 1 000 000 ₸' },
        'test-token-123',
      );
      expect(useGoalStore.getState().yearlyGoals).toHaveLength(1);
      expect(useGoalStore.getState().yearlyGoals[0].id).toBe('yg-1');
    });

    it('appends to existing list', async () => {
      useGoalStore.setState({ yearlyGoals: [MOCK_YEARLY_GOAL] });
      mockApi.post.mockResolvedValueOnce(MOCK_YEARLY_GOAL_2);

      await useGoalStore.getState().createYearlyGoal({
        year: 2026,
        area: 'health',
        goalText: 'Пробежать марафон',
      });

      expect(useGoalStore.getState().yearlyGoals).toHaveLength(2);
    });
  });

  describe('updateYearlyGoal', () => {
    it('updates progress of a yearly goal', async () => {
      useGoalStore.setState({ yearlyGoals: [MOCK_YEARLY_GOAL] });
      const updated = { ...MOCK_YEARLY_GOAL, progress: 0.55 };
      mockApi.put.mockResolvedValueOnce(updated);

      await useGoalStore.getState().updateYearlyGoal('yg-1', { progress: 0.55 });

      expect(mockApi.put).toHaveBeenCalledWith(
        '/goals/yearly/yg-1',
        { progress: 0.55 },
        'test-token-123',
      );
      expect(useGoalStore.getState().yearlyGoals[0].progress).toBe(0.55);
    });

    it('only updates the matching goal', async () => {
      useGoalStore.setState({ yearlyGoals: [MOCK_YEARLY_GOAL, MOCK_YEARLY_GOAL_2] });
      const updated = { ...MOCK_YEARLY_GOAL, progress: 0.8 };
      mockApi.put.mockResolvedValueOnce(updated);

      await useGoalStore.getState().updateYearlyGoal('yg-1', { progress: 0.8 });

      expect(useGoalStore.getState().yearlyGoals[0].progress).toBe(0.8);
      expect(useGoalStore.getState().yearlyGoals[1].progress).toBe(0.1); // unchanged
    });
  });

  describe('deleteYearlyGoal', () => {
    it('removes yearly goal from list', async () => {
      useGoalStore.setState({ yearlyGoals: [MOCK_YEARLY_GOAL, MOCK_YEARLY_GOAL_2] });
      mockApi.delete.mockResolvedValueOnce(undefined);

      await useGoalStore.getState().deleteYearlyGoal('yg-1');

      const goals = useGoalStore.getState().yearlyGoals;
      expect(goals).toHaveLength(1);
      expect(goals[0].id).toBe('yg-2');
    });
  });

  describe('fetchWeeklyGoals', () => {
    it('fetches weekly goals with week param', async () => {
      mockApi.get.mockResolvedValueOnce([MOCK_WEEKLY_GOAL]);

      await useGoalStore.getState().fetchWeeklyGoals('2026-04-13');

      expect(mockApi.get).toHaveBeenCalledWith('/goals/weekly?week=2026-04-13', 'test-token-123');
      expect(useGoalStore.getState().weeklyGoals).toHaveLength(1);
    });

    it('fetches weekly goals without week param', async () => {
      mockApi.get.mockResolvedValueOnce([]);

      await useGoalStore.getState().fetchWeeklyGoals();

      expect(mockApi.get).toHaveBeenCalledWith('/goals/weekly', 'test-token-123');
    });
  });

  describe('createWeeklyGoal', () => {
    it('creates and appends a weekly goal', async () => {
      mockApi.post.mockResolvedValueOnce(MOCK_WEEKLY_GOAL);

      await useGoalStore.getState().createWeeklyGoal('2026-04-13', 'Закрыть все задачи');

      expect(mockApi.post).toHaveBeenCalledWith(
        '/goals/weekly',
        { weekStart: '2026-04-13', goalText: 'Закрыть все задачи' },
        'test-token-123',
      );
      expect(useGoalStore.getState().weeklyGoals).toHaveLength(1);
    });
  });

  describe('updateWeeklyGoal', () => {
    it('updates a weekly goal', async () => {
      useGoalStore.setState({ weeklyGoals: [MOCK_WEEKLY_GOAL] });
      const updated = { ...MOCK_WEEKLY_GOAL, completed: true };
      mockApi.put.mockResolvedValueOnce(updated);

      await useGoalStore.getState().updateWeeklyGoal('wg-1', { completed: true });

      expect(useGoalStore.getState().weeklyGoals[0].completed).toBe(true);
    });
  });

  describe('deleteWeeklyGoal', () => {
    it('removes weekly goal from list', async () => {
      useGoalStore.setState({ weeklyGoals: [MOCK_WEEKLY_GOAL, MOCK_WEEKLY_GOAL_2] });
      mockApi.delete.mockResolvedValueOnce(undefined);

      await useGoalStore.getState().deleteWeeklyGoal('wg-1');

      expect(useGoalStore.getState().weeklyGoals).toHaveLength(1);
      expect(useGoalStore.getState().weeklyGoals[0].id).toBe('wg-2');
    });
  });
});
