/**
 * Аудит 2026-11-07: очередь офлайн-записей хранится на телефоне. Без владельца
 * записи аккаунта А уходили в аккаунт Б, вошедшего на том же телефоне
 * (дневник с личными заметками, траты, задачи).
 */
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => {}), fetch: jest.fn(async () => ({ isConnected: true })) }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineQueue } from '@/services/offline-manager';
import { storage } from '@/services/storage';

const m = (userId: string | undefined, endpoint = '/journal') => ({ method: 'POST' as const, endpoint, body: { notes: 'личное' }, userId });

beforeEach(async () => {
  await offlineQueue.clear();
});

describe('очередь: только от имени владельца', () => {
  it('запись А при входе Б не отправляется и выкидывается', async () => {
    await offlineQueue.enqueue(m('A'));
    const exec = jest.fn(async () => true);
    await offlineQueue.sync(exec, 'B');
    expect(exec).not.toHaveBeenCalled();
    expect(offlineQueue.pendingCount).toBe(0);
  });

  it('запись А при входе А — уходит', async () => {
    await offlineQueue.enqueue(m('A'));
    const exec = jest.fn(async () => true);
    await offlineQueue.sync(exec, 'A');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('старая запись без владельца не уходит никому', async () => {
    await offlineQueue.enqueue(m(undefined));
    const exec = jest.fn(async () => true);
    await offlineQueue.sync(exec, 'A');
    expect(exec).not.toHaveBeenCalled();
  });

  it('выход во время отправки (сервер отклонил токен) — неотправленное не возвращается в очередь', async () => {
    await offlineQueue.enqueue(m('A'));
    await offlineQueue.sync(async () => {
      await offlineQueue.clear(); // logout посреди отправки
      throw new Error('401');
    }, 'A');
    expect(offlineQueue.pendingCount).toBe(0);
    expect(await AsyncStorage.getItem('lifeos_offline_queue')).toBeNull();
  });
});

describe('выход из аккаунта чистит телефон', () => {
  it('очередь, кэш ответов, заметки недели и вода удалены; чужие ключи на месте', async () => {
    const { wipeUserDeviceData } = jest.requireActual('@/services/offline-sync') as typeof import('@/services/offline-sync');
    await offlineQueue.enqueue(m('A'));
    await AsyncStorage.setItem('lifeos_cache_/tasks', '[{"title":"А"}]');
    storage.set('week_notes:2026-11-02', '{"notes":"А"}');
    storage.set('water:2026-11-07', '3');
    storage.set('themeName', 'dark');
    await wipeUserDeviceData();
    expect(offlineQueue.pendingCount).toBe(0);
    expect(await AsyncStorage.getItem('lifeos_cache_/tasks')).toBeNull();
    expect(storage.getString('week_notes:2026-11-02')).toBeUndefined();
    expect(storage.getString('water:2026-11-07')).toBeUndefined();
    expect(storage.getString('themeName')).toBe('dark');
  });
});

describe('повтор записи без дублей (Idempotency-Key)', () => {
  it('ключ хранится в записи очереди и уходит при отправке тот же', async () => {
    await offlineQueue.enqueue({ ...m('A', '/finance/expenses'), idempotencyKey: 'm-key-123456' });
    const exec = jest.fn(async () => true);
    await offlineQueue.sync(exec, 'A');
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'm-key-123456' }));
  });

  it('ключ подходит под формат сервера и не повторяется', () => {
    const { newIdempotencyKey } = jest.requireActual('@/services/api') as typeof import('@/services/api');
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(a).not.toBe(b);
  });
});
