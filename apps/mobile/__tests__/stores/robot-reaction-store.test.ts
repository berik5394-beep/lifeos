import { api } from '@/services/api';
import { useFinanceStore } from '@/stores/finance-store';
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { budgetReactionText, useRobotReactionStore } from '@/stores/robot-reaction-store';

const mockApi = api as jest.Mocked<typeof api>;

const EXPENSE = {
  id: 'exp-1',
  userId: 'user-1',
  date: '2026-11-08',
  category: 'food',
  description: 'Обед',
  amount: 6000,
  createdAt: '2026-11-08T12:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  useRobotReactionStore.setState({ reaction: null });
  useFinanceStore.setState({ expenses: [] });
});

describe('budgetReactionText', () => {
  it('молчит без предупреждения сервера', () => {
    expect(budgetReactionText('food', undefined)).toBeNull();
    expect(budgetReactionText('food', { limit: 50000, spent: 10000, percentage: 20 })).toBeNull();
  });

  it('≥80%: процент и остаток, категория по-русски', () => {
    const t = budgetReactionText('food', { limit: 50000, spent: 42500, percentage: 85, warning: 'x' });
    expect(t).toBe('На «Еда» ушло 85% лимита — осталось 7 500 ₸.');
  });

  it('≥100%: превышен, сколько из скольких', () => {
    const t = budgetReactionText('transport', { limit: 20000, spent: 26000, percentage: 130, warning: 'x' });
    expect(t).toBe('Лимит на «Транспорт» превышен: 26 000 ₸ из 20 000 ₸.');
  });
});

describe('реакция робота на действия с экрана', () => {
  it('трата сверх лимита → тревога + облачко; budgetInfo не попадает в список', async () => {
    mockApi.post.mockResolvedValueOnce({
      ...EXPENSE,
      budgetInfo: { limit: 50000, spent: 56000, percentage: 112, warning: 'Лимит превышен' },
    });
    await useFinanceStore.getState().createExpense({
      date: '2026-11-08',
      category: 'food',
      description: 'Обед',
      amount: 6000,
    });
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('worried');
    expect(r?.text).toContain('превышен');
    expect(useFinanceStore.getState().expenses[0]).toEqual(EXPENSE);
  });

  it('трата в рамках лимита → робот молчит', async () => {
    mockApi.post.mockResolvedValueOnce({ ...EXPENSE, budgetInfo: { limit: 50000, spent: 6000, percentage: 12 } });
    await useFinanceStore.getState().createExpense({ date: '2026-11-08', category: 'food', description: 'Обед', amount: 6000 });
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });

  it('закрыл задачу → радость; снял галочку → нет', async () => {
    const task = { id: 't1', title: 'Отчёт', completed: false } as never;
    useTaskStore.setState({ tasks: [task] });
    mockApi.patch.mockResolvedValueOnce({ id: 't1', title: 'Отчёт', completed: true });
    await useTaskStore.getState().toggleComplete('t1');
    expect(useRobotReactionStore.getState().reaction?.emotion).toBe('happy');

    useRobotReactionStore.setState({ reaction: null });
    mockApi.patch.mockResolvedValueOnce({ id: 't1', title: 'Отчёт', completed: false });
    await useTaskStore.getState().toggleComplete('t1');
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });

  it('отметил привычку → радость', async () => {
    mockApi.post.mockResolvedValueOnce({ id: 'l1', habitId: 'h1', userId: 'u', date: '2026-11-08', completed: true, autoCompleted: false });
    await useHabitStore.getState().toggleHabitLog('h1', '2026-11-08', true);
    expect(useRobotReactionStore.getState().reaction?.emotion).toBe('happy');
  });
});
