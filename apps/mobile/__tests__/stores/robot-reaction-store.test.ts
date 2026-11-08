import { api } from '@/services/api';
import { useFinanceStore } from '@/stores/finance-store';
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { useGoalStore } from '@/stores/goal-store';
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

describe('разбор цели после постановки с экрана', () => {
  const GOAL = { id: 'g1', userId: 'u', year: 2026, area: 'finance', goalText: 'Миллион', progress: 0 };

  it('цель сохраняется сразу, разбор приходит облачком «thinking» и держится дольше', async () => {
    useGoalStore.setState({ yearlyGoals: [] });
    mockApi.post
      .mockResolvedValueOnce(GOAL)
      .mockResolvedValueOnce({ text: 'Про цель «Миллион»:\nЭто 100 000 ₸ в месяц…' });
    await useGoalStore.getState().createYearlyGoal({ year: 2026, area: 'finance', goalText: 'Миллион' });
    expect(useGoalStore.getState().yearlyGoals).toHaveLength(1);
    expect(mockApi.post).toHaveBeenLastCalledWith('/goals/yearly/g1/intake', {}, 'test-token-123');
    await new Promise((r) => setImmediate(r));
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('thinking');
    expect(r?.text).toContain('Про цель «Миллион»');
    expect(r?.holdMs).toBeGreaterThan(9000);
  });

  it('разбора нет (флаг выкл.) или сбой — робот молчит, цель сохранена', async () => {
    useGoalStore.setState({ yearlyGoals: [] });
    mockApi.post.mockResolvedValueOnce(GOAL).mockRejectedValueOnce(new Error('сеть'));
    await useGoalStore.getState().createYearlyGoal({ year: 2026, area: 'finance', goalText: 'Миллион' });
    await new Promise((r) => setImmediate(r));
    expect(useGoalStore.getState().yearlyGoals).toHaveLength(1);
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });
});

import { useEventStore } from '@/stores/event-store';
describe('наложение по времени с экрана', () => {
  it('задача поверх встречи → тревога + текст сервера; conflictWarning не попадает в список', async () => {
    useTaskStore.setState({ tasks: [] });
    mockApi.post.mockResolvedValueOnce({ id: 't9', title: 'Позвонить', completed: false, conflictWarning: 'Накладывается на время с встречей «Планёрка» 10:00–11:00.' });
    await useTaskStore.getState().createTask({ title: 'Позвонить', category: 'work', priority: 'medium', date: '2026-12-01', time: '10:30' } as never);
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('worried');
    expect(r?.text).toContain('Планёрка');
    expect(useTaskStore.getState().tasks[0]).not.toHaveProperty('conflictWarning');
  });

  it('встреча поверх задачи → тревога; без наложения — молчит', async () => {
    useEventStore.setState({ events: [] } as never);
    mockApi.post.mockResolvedValueOnce({ id: 'e1', title: 'Встреча', date: '2026-12-01', conflictWarning: 'Накладывается на время с задачей «Отчёт» в 14:15.' });
    await useEventStore.getState().createEvent({ title: 'Встреча', date: '2026-12-01', startTime: '14:00', endTime: '15:00' } as never);
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Отчёт');

    useRobotReactionStore.setState({ reaction: null });
    mockApi.post.mockResolvedValueOnce({ id: 'e2', title: 'Обед', date: '2026-12-01' });
    await useEventStore.getState().createEvent({ title: 'Обед', date: '2026-12-01', startTime: '13:00' } as never);
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });
});

describe('быстрая строка задачи со временем', () => {
  it('сервер нашёл наложение → облачко', async () => {
    useTaskStore.setState({ tasks: [] });
    mockApi.post.mockResolvedValueOnce({
      task: { id: 't10', title: 'Позвонить', completed: false },
      conflictWarning: 'Накладывается на время с встречей «Планёрка» 10:00–11:00.',
    });
    await useTaskStore.getState().quickAdd('позвонить завтра в 10:30');
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Планёрка');
    expect(useTaskStore.getState().tasks[0]).toEqual({ id: 't10', title: 'Позвонить', completed: false });
  });
});
