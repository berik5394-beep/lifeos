/**
 * Запуск без сети не должен выкидывать из аккаунта: раньше любая ошибка
 * обновления токена (в т.ч. «нет интернета») вызывала logout.
 */
jest.unmock('@/stores/auth-store');
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => {}),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { api, ApiError } from '@/services/api';

const { useAuthStore } = jest.requireActual('@/stores/auth-store') as typeof import('@/stores/auth-store');
const mocked = api as jest.Mocked<typeof api>;

// Сам выход (чистка сторов через динамический import) в jest не запускается — проверяем, что он вызван.
const logout = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: 'old-access', refreshToken: 'refresh-1', user: null, logout });
});

describe('обновление токена при запуске', () => {
  it.each([0, 500, 503, 429])('ошибка %i (нет сети / сервер) → остаёмся в аккаунте', async (status) => {
    mocked.post.mockRejectedValueOnce(new ApiError(status, 'x'));
    await useAuthStore.getState().refreshAuth();
    expect(logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('old-access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
  });

  it('сервер отклонил токен (401) → выход', async () => {
    mocked.post.mockRejectedValueOnce(new ApiError(401, 'Invalid refresh token'));
    await useAuthStore.getState().refreshAuth();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('успех → новые токены', async () => {
    mocked.post.mockResolvedValueOnce({ accessToken: 'new-access', refreshToken: 'refresh-2' });
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState()).toMatchObject({ token: 'new-access', refreshToken: 'refresh-2' });
  });
});
