/**
 * Выход из аккаунта: раньше не отписывал пуши и не отзывал токены на сервере —
 * на телефон шли пуши вышедшего аккаунта (аудит 2026-11-08).
 */
jest.unmock('@/stores/auth-store');
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => {}),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { api } from '@/services/api';

const { useAuthStore } = jest.requireActual('@/stores/auth-store') as typeof import('@/stores/auth-store');
const mocked = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: 'access-1', refreshToken: 'refresh-1', user: null });
});

describe('logout', () => {
  it('до чистки: отписать пуши и отозвать токены — с текущим токеном', async () => {
    mocked.delete.mockResolvedValueOnce({ ok: true });
    mocked.post.mockResolvedValueOnce({ ok: true });
    // Чистка сторов через динамический import в jest не запускается — нам важно, что было ДО неё.
    await useAuthStore.getState().logout().catch(() => {});
    expect(mocked.delete).toHaveBeenCalledWith('/notifications/register-token', 'access-1');
    expect(mocked.post).toHaveBeenCalledWith('/auth/logout', {}, 'access-1');
  });

  it('без сети прощальные запросы падают — выход всё равно идёт дальше', async () => {
    mocked.delete.mockRejectedValueOnce(new Error('нет сети'));
    mocked.post.mockRejectedValueOnce(new Error('нет сети'));
    const SecureStore = jest.requireMock('expo-secure-store') as { deleteItemAsync: jest.Mock };
    await useAuthStore.getState().logout().catch(() => {});
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('token');
  });

  it('без токена — на сервер не ходим', async () => {
    useAuthStore.setState({ token: null });
    await useAuthStore.getState().logout().catch(() => {});
    expect(mocked.delete).not.toHaveBeenCalled();
  });
});
