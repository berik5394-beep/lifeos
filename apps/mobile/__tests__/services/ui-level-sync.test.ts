jest.unmock('@/services/storage');

import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { chooseUiLevel, syncUiLevel } from '@/services/ui-level-sync';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), patch: jest.fn() },
}));
const mockApi = api as unknown as { get: jest.Mock; patch: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  storage.remove('ui_complexity');
  storage.remove('ui_complexity_dirty');
  useUIStore.setState({ complexity: 'standard' });
  (useAuthStore.getState as jest.Mock).mockReturnValue({ token: 'tok' });
});

describe('уровень интерфейса в аккаунте', () => {
  it('выбор → на экране и в аккаунте', async () => {
    mockApi.patch.mockResolvedValueOnce({});
    await chooseUiLevel('power');
    expect(useUIStore.getState().complexity).toBe('power');
    expect(mockApi.patch).toHaveBeenCalledWith('/auth/profile', { uiComplexity: 'power' }, 'tok');
    expect(storage.getBoolean('ui_complexity_dirty')).toBeUndefined();
  });

  it('другой телефон: в аккаунте «Продвинутый» → применяется', async () => {
    mockApi.get.mockResolvedValueOnce({ user: { uiComplexity: 'power' } });
    await syncUiLevel();
    expect(useUIStore.getState().complexity).toBe('power');
    expect(mockApi.patch).not.toHaveBeenCalled();
  });

  it('выбрал без сети → при входе отправляем выбор, а не перетираем старым с сервера', async () => {
    mockApi.patch.mockRejectedValueOnce(new Error('offline'));
    await chooseUiLevel('simple');
    expect(storage.getBoolean('ui_complexity_dirty')).toBe(true);
    mockApi.patch.mockResolvedValueOnce({});
    await syncUiLevel();
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(mockApi.patch).toHaveBeenLastCalledWith('/auth/profile', { uiComplexity: 'simple' }, 'tok');
    expect(useUIStore.getState().complexity).toBe('simple');
  });

  it('в аккаунте пусто, а на телефоне выбран уровень → переносим в аккаунт', async () => {
    useUIStore.getState().setComplexity('power');
    mockApi.get.mockResolvedValueOnce({ user: { uiComplexity: null } });
    mockApi.patch.mockResolvedValueOnce({});
    await syncUiLevel();
    expect(mockApi.patch).toHaveBeenCalledWith('/auth/profile', { uiComplexity: 'power' }, 'tok');
  });

  it('без сети — остаётся то, что на телефоне', async () => {
    useUIStore.getState().setComplexity('power');
    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    await syncUiLevel();
    expect(useUIStore.getState().complexity).toBe('power');
  });
});
