import { api } from '@/services/api';
import { useGoalStore } from '@/stores/goal-store';

/** Цели на месяц в приложении (аудит 2026-11-09). */
const mocked = api as jest.Mocked<typeof api>;
const G = (id: string, completed = false) => ({ id, userId: 'u', monthStart: '2026-11-01', goalText: id, completed, order: 0 });

beforeEach(() => {
  useGoalStore.setState({ monthlyGoals: [] });
  jest.clearAllMocks();
});

describe('monthly goals', () => {
  it('грузит месяц, добавляет, отмечает, убирает', async () => {
    mocked.get.mockResolvedValueOnce([G('a')]);
    await useGoalStore.getState().fetchMonthlyGoals('2026-11');
    expect(mocked.get).toHaveBeenCalledWith('/goals/monthly?month=2026-11', expect.anything());
    mocked.post.mockResolvedValueOnce(G('b'));
    await useGoalStore.getState().createMonthlyGoal('2026-11', 'b');
    mocked.put.mockResolvedValueOnce(G('a', true));
    await useGoalStore.getState().updateMonthlyGoal('a', { completed: true });
    mocked.delete.mockResolvedValueOnce({ success: true });
    await useGoalStore.getState().deleteMonthlyGoal('b');
    expect(useGoalStore.getState().monthlyGoals).toEqual([G('a', true)]);
  });
  it('сбой отметки — галочка откатывается', async () => {
    useGoalStore.setState({ monthlyGoals: [G('a')] });
    mocked.put.mockRejectedValueOnce(new Error('500'));
    await expect(useGoalStore.getState().updateMonthlyGoal('a', { completed: true })).rejects.toThrow();
    expect(useGoalStore.getState().monthlyGoals[0].completed).toBe(false);
  });
});
