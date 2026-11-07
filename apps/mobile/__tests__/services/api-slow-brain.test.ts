/**
 * Мозг думал > 15 с → телефон обрывал ожидание и писал «нет интернета», а сервер
 * доделывал команду; повтор давал дубль. Теперь: таймаут = честное «думаю
 * дольше обычного, не повторяй сразу» (408), а мозгу дают ждать до 60 с.
 */
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => {}), fetch: jest.fn(async () => ({ isConnected: true })) }));
const { api, ApiError, SLOW_SERVER_ERROR, BRAIN_TIMEOUT_MS } = jest.requireActual('@/services/api') as typeof import('@/services/api');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('медленный мозг ≠ нет интернета', () => {
  it('обрыв по таймауту → 408 «думаю дольше обычного»', async () => {
    global.fetch = jest.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    await expect(api.post('/voice/chat', { text: 'привет' }, 'tok', { timeoutMs: 10 })).rejects.toMatchObject({
      status: 408,
      message: SLOW_SERVER_ERROR,
    });
  });

  it('нет сети (не таймаут) → по-прежнему «нет интернета» (0)', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const err = await api.post('/voice/chat', { text: 'привет' }, 'tok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as { status: number }).status).toBe(0);
  });

  it('мозгу дают ждать до минуты', () => {
    expect(BRAIN_TIMEOUT_MS).toBe(60_000);
  });
});
