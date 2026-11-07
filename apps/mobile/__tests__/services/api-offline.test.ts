/**
 * Клиент API без сети. Раньше любая запись без сети возвращала `{}` (сторы клали
 * его в списки), а очередь никто не отправлял. Теперь: в очередь — только по
 * флагу, и тогда OfflineQueuedError; остальное — честное «нет интернета».
 */
jest.unmock('@/services/api');

const mockEnqueue = jest.fn(async () => {});
jest.mock('@/services/offline-manager', () => ({
  networkMonitor: { isConnected: true },
  offlineQueue: { enqueue: (...a: unknown[]) => mockEnqueue(...(a as [])) },
  getCachedData: jest.fn(async () => null),
  cacheData: jest.fn(async () => {}),
}));

const { api, ApiError, isOfflineQueued, QUEUE_OFFLINE } = jest.requireActual('@/services/api') as typeof import('@/services/api');

const fetchMock = jest.fn();
beforeEach(() => {
  mockEnqueue.mockClear();
  fetchMock.mockReset();
  (global as { fetch: unknown }).fetch = fetchMock;
});

describe('запись без сети', () => {
  it('по флагу очереди → в очередь и OfflineQueuedError, а не {}', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await api.post('/tasks', { title: 'X' }, 'tok', QUEUE_OFFLINE).catch((e: unknown) => e);
    expect(isOfflineQueued(err)).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledWith({ method: 'POST', endpoint: '/tasks', body: { title: 'X' } });
  });

  it('без флага (ИИ, чат, вход) → «нет интернета», в очередь не кладём', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const err = await api.post('/voice/chat', { text: 'привет' }, 'tok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isOfflineQueued(err)).toBe(false);
    expect((err as InstanceType<typeof ApiError>).status).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('владелец записи', () => {
  it('запись в очереди помнит, чья она (иначе ушла бы следующему аккаунту на телефоне)', async () => {
    const { useAuthStore } = jest.requireMock('@/stores/auth-store') as { useAuthStore: { getState: jest.Mock } };
    useAuthStore.getState.mockReturnValueOnce({ token: 'tok', user: { id: 'user-A' } });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await api.post('/journal', { notes: 'x' }, 'tok', QUEUE_OFFLINE).catch(() => {});
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ endpoint: '/journal', userId: 'user-A' }));
  });
});

describe('повтор из очереди', () => {
  const ok = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) };
  const bad = (status: number) => ({ ok: false, status, headers: { get: () => 'application/json' }, text: async () => '{"message":"x"}' });

  it('ушло → true; 404 → false (выкинуть); нет сети/5xx → бросает (оставить)', async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await expect(api.replayQueued({ method: 'POST', endpoint: '/tasks', body: {} }, 'tok')).resolves.toBe(true);
    fetchMock.mockResolvedValueOnce(bad(404));
    await expect(api.replayQueued({ method: 'PATCH', endpoint: '/tasks/offline-1/complete' }, 'tok')).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(bad(503));
    await expect(api.replayQueued({ method: 'POST', endpoint: '/tasks' }, 'tok')).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(api.replayQueued({ method: 'POST', endpoint: '/tasks' }, 'tok')).rejects.toBeInstanceOf(ApiError);
  });
});
