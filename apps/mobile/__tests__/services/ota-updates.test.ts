jest.mock('expo-updates', () => ({ isEnabled: false }));

import { startOtaUpdates } from '@/services/ota-updates';

type Listener = (s: string) => void;

function setup(over: { available?: boolean; isNew?: boolean; enabled?: boolean } = {}) {
  let listener: Listener = () => {};
  const appState = {
    addEventListener: jest.fn((_e: string, cb: Listener) => {
      listener = cb;
      return { remove: jest.fn() };
    }),
  };
  const updates = {
    isEnabled: over.enabled ?? true,
    checkForUpdateAsync: jest.fn(async () => ({ isAvailable: over.available ?? true })),
    fetchUpdateAsync: jest.fn(async () => ({ isNew: over.isNew ?? true })),
    reloadAsync: jest.fn(async () => {}),
  };
  let t = 1_000_000;
  const now = () => t;
  const advance = (ms: number) => {
    t += ms;
  };
  const flush = () => new Promise((r) => setImmediate(r));
  return { updates, appState, now, advance, flush, emit: (s: string) => listener(s) };
}

const g = globalThis as unknown as { __DEV__: boolean };

describe('startOtaUpdates', () => {
  const dev = g.__DEV__;
  beforeEach(() => {
    g.__DEV__ = false;
  });
  afterAll(() => {
    g.__DEV__ = dev;
  });

  it('скачивает обновление при запуске и применяет, только когда приложение ушло в фон', async () => {
    const h = setup();
    startOtaUpdates({ updates: h.updates as never, appState: h.appState as never, now: h.now });
    await h.flush();
    expect(h.updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    h.emit('inactive');
    expect(h.updates.reloadAsync).not.toHaveBeenCalled();
    h.emit('background');
    expect(h.updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('нет обновления — ничего не перезапускает; проверка не чаще раза в 10 минут', async () => {
    const h = setup({ available: false });
    startOtaUpdates({ updates: h.updates as never, appState: h.appState as never, now: h.now });
    await h.flush();
    h.emit('active');
    await h.flush();
    expect(h.updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    h.advance(11 * 60 * 1000);
    h.emit('active');
    await h.flush();
    expect(h.updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
    h.emit('background');
    expect(h.updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('сбой сети при проверке — молча остаёмся на текущей версии', async () => {
    const h = setup();
    h.updates.checkForUpdateAsync.mockRejectedValueOnce(new Error('offline'));
    startOtaUpdates({ updates: h.updates as never, appState: h.appState as never, now: h.now });
    await h.flush();
    h.emit('background');
    expect(h.updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('в разработке или без expo-updates — выключено', () => {
    g.__DEV__ = true;
    const h = setup();
    startOtaUpdates({ updates: h.updates as never, appState: h.appState as never, now: h.now });
    expect(h.updates.checkForUpdateAsync).not.toHaveBeenCalled();
    g.__DEV__ = false;
    const h2 = setup({ enabled: false });
    startOtaUpdates({ updates: h2.updates as never, appState: h2.appState as never, now: h2.now });
    expect(h2.updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});
