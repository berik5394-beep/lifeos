import { api, ApiError } from '@/services/api';
import { useTaskStore } from '@/stores/task-store';
import { useAuthStore } from '@/stores/auth-store';

// Глобальный мок api (setup.ts) без ApiError — берём настоящий класс.
jest.mock('@/services/api', () => {
  const actual = jest.requireActual('@/services/api');
  return { ApiError: actual.ApiError, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } };
});
const mocked = api as jest.Mocked<typeof api>;
const TASK = { id: 't1', userId: 'u', title: 'Купить хлеб', category: 'personal', priority: 'medium', date: '2026-11-06', time: null, completed: false, notes: null, createdAt: '' };

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore.getState as jest.Mock).mockReturnValue({ token: 'tok' });
  useTaskStore.setState({ tasks: [] });
});

describe('добавление задачи тапом: разбор фразы не сработал', () => {
  it('сервер не смог разобрать (500) → задача всё равно записана как есть, на сегодня', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(500, 'Не удалось распарсить текст')).mockResolvedValueOnce(TASK);
    await useTaskStore.getState().quickAdd('Купить хлеб');
    expect(mocked.post).toHaveBeenLastCalledWith(
      '/tasks',
      expect.objectContaining({ title: 'Купить хлеб', category: 'personal', priority: 'medium', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      'tok',
    );
    expect(useTaskStore.getState().tasks).toEqual([TASK]);
  });

  it('нет сети/доступа (401) → честная ошибка без сырого текста сервера, задачу не дублируем', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(401, '{"type":"error"}'));
    await expect(useTaskStore.getState().quickAdd('Купить хлеб')).rejects.toThrow('Не получилось добавить задачу');
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });
});
