import { api, ApiError, OfflineQueuedError } from '@/services/api';
import { useTaskStore } from '@/stores/task-store';
import { useFinanceStore } from '@/stores/finance-store';
import { useHabitStore } from '@/stores/habit-store';
import { useJournalStore } from '@/stores/journal-store';

/**
 * Без сети запись ставится в очередь (api бросает OfflineQueuedError).
 * Раньше api отдавал `{}`, и сторы клали его в списки пустой строкой.
 * Теперь стор сразу показывает запись локально, а настоящая ошибка — ошибка.
 */
const mocked = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  useTaskStore.setState({ tasks: [] });
  useFinanceStore.setState({ expenses: [], incomes: [] });
  useHabitStore.setState({ habits: [], logs: {} });
  useJournalStore.setState({ entries: [], todayEntry: null, isLoading: false });
});

describe('без сети запись видна сразу', () => {
  it('задача: локальная запись с временным id, без пустых строк', async () => {
    mocked.post.mockRejectedValueOnce(new OfflineQueuedError());
    await useTaskStore.getState().createTask({ title: 'Купить хлеб', category: 'personal', priority: 'medium', date: '2026-11-06' });
    const [t] = useTaskStore.getState().tasks;
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(t).toMatchObject({ title: 'Купить хлеб', date: '2026-11-06', completed: false });
    expect(t.id).toMatch(/^offline-/);
  });

  it('задача: отметка без сети не откатывается', async () => {
    useTaskStore.setState({
      tasks: [{ id: 't1', userId: 'u', title: 'X', category: 'work', priority: 'low', date: '2026-11-06', time: null, completed: false, notes: null, createdAt: '' }],
    });
    mocked.patch.mockRejectedValueOnce(new OfflineQueuedError());
    await useTaskStore.getState().toggleComplete('t1');
    expect(useTaskStore.getState().tasks[0].completed).toBe(true);
  });

  it('быстрое добавление без сети → пишем как есть, на сегодня (в очередь)', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(0, 'Нет интернета')).mockRejectedValueOnce(new OfflineQueuedError());
    await useTaskStore.getState().quickAdd('Позвонить маме');
    expect(useTaskStore.getState().tasks.map((t) => t.title)).toEqual(['Позвонить маме']);
  });

  it('трата: локальная запись сверху списка', async () => {
    mocked.post.mockRejectedValueOnce(new OfflineQueuedError());
    await useFinanceStore.getState().createExpense({ date: '2026-11-06', category: 'food', description: 'Обед', amount: 3000 });
    expect(useFinanceStore.getState().expenses[0]).toMatchObject({ amount: 3000, description: 'Обед' });
  });

  it('привычка: отметка без сети видна сразу', async () => {
    mocked.post.mockRejectedValueOnce(new OfflineQueuedError());
    await useHabitStore.getState().toggleHabitLog('h1', '2026-11-06', true);
    expect(useHabitStore.getState().logs['2026-11-06']).toEqual([expect.objectContaining({ habitId: 'h1', completed: true })]);
  });

  it('настоящая ошибка сервера — ошибка, в список ничего не попадает', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(500, 'Ошибка сервера'));
    await expect(useFinanceStore.getState().createExpense({ date: '2026-11-06', category: 'food', description: 'Обед', amount: 3000 })).rejects.toThrow();
    expect(useFinanceStore.getState().expenses).toEqual([]);
  });
});

describe('дневник', () => {
  it('сервер упал → saveEntry бросает (экран не пишет «Сохранено»)', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(500, 'Ошибка сервера'));
    await expect(useJournalStore.getState().saveEntry({ date: '2026-11-01', mood: 8 })).rejects.toThrow('Ошибка сервера');
  });

  it('без сети — сохраняем локально поверх прежнего за этот день', async () => {
    useJournalStore.setState({ entries: [{ date: '2026-11-01', sleepHours: 7, energy: 5, mood: 4, notes: 'ок' }] });
    mocked.post.mockRejectedValueOnce(new OfflineQueuedError());
    await useJournalStore.getState().saveEntry({ date: '2026-11-01', mood: 8 });
    expect(useJournalStore.getState().entries).toEqual([{ date: '2026-11-01', sleepHours: 7, energy: 5, mood: 8, notes: 'ок' }]);
  });

  it('прошлый день загружается и находится по дню (сервер шлёт ISO-дату)', async () => {
    mocked.get.mockResolvedValueOnce({ id: 'j1', date: '2026-11-01T00:00:00.000Z', sleepHours: 6, energy: 3, mood: 6, notes: null });
    await useJournalStore.getState().fetchEntry('2026-11-01');
    expect(useJournalStore.getState().entries).toEqual([expect.objectContaining({ id: 'j1', date: '2026-11-01', mood: 6 })]);
  });
});
