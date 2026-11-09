import { api } from '@/services/api';
import { useTaskStore, fetchRange } from '@/stores/task-store';

/** Аудит 2026-11-09: экраны с разными выборками не затирают друг другу задачи. */
const mockedApi = api as jest.Mocked<typeof api>;
const T = (id: string, date: string) => ({
  id, userId: 'u', title: id, category: 'work', priority: 'low', date: `${date}T00:00:00.000Z`,
  time: null, completed: false, notes: null, createdAt: '2026-11-01T00:00:00Z',
});

beforeEach(() => {
  useTaskStore.setState({ tasks: [], isLoading: false });
  jest.clearAllMocks();
});

describe('fetchRange', () => {
  it('неделя / день / месяц / всё', () => {
    expect(fetchRange(undefined, '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-16' });
    expect(fetchRange('2026-11-30')).toEqual({ from: '2026-11-30', to: '2026-12-01' });
    expect(fetchRange(undefined, undefined, '2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(fetchRange()).toBeNull();
  });
});

describe('fetchTasks — меняет только свой диапазон', () => {
  it('месяц после недели не стирает и не дублирует; неделя заменяет только свою неделю', async () => {
    mockedApi.get.mockResolvedValueOnce([T('nov20', '2026-11-20'), T('nov10', '2026-11-10')]);
    await useTaskStore.getState().fetchTasks(undefined, undefined, '2026-11');
    // неделя 9–15: задача nov10 удалена на сервере, появилась nov11
    mockedApi.get.mockResolvedValueOnce([T('nov11', '2026-11-11')]);
    await useTaskStore.getState().fetchTasks(undefined, '2026-11-09');
    expect(useTaskStore.getState().tasks.map((t) => t.id).sort()).toEqual(['nov11', 'nov20']);
  });
  it('без параметров — заменяет всё (как раньше)', async () => {
    useTaskStore.setState({ tasks: [T('old', '2026-01-01')] as never });
    mockedApi.get.mockResolvedValueOnce([T('a', '2026-11-11')]);
    await useTaskStore.getState().fetchTasks();
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['a']);
  });
});
