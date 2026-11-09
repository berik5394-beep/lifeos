jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: jest.fn(async () => {}), getItem: jest.fn(async () => null), removeItem: jest.fn(async () => {}) }));
import { offlineQueue, swapLocalId, type QueuedMutation } from '@/services/offline-manager';

/** Аудит 2026-11-09: без сети создал и сразу отметил/удалил — после связи второе не теряется. */
describe('офлайн-очередь: временный id → настоящий', () => {
  it('swapLocalId меняет адрес и тело', () => {
    const m = { id: '1', method: 'PATCH', endpoint: '/tasks/offline-1/complete', body: { completed: true, ref: 'offline-1' }, createdAt: 0 } as QueuedMutation;
    expect(swapLocalId(m, 'offline-1', 'real-9')).toMatchObject({ endpoint: '/tasks/real-9/complete', body: { completed: true, ref: 'real-9' } });
  });

  it('создание → настоящий id подставлен в отметку; создание не ушло → отметка ждёт', async () => {
    const sent: string[] = [];
    await offlineQueue.enqueue({ method: 'POST', endpoint: '/tasks', body: { title: 'x' }, userId: 'u', localId: 'offline-a' });
    await offlineQueue.enqueue({ method: 'PATCH', endpoint: '/tasks/offline-a/complete', body: { completed: true }, userId: 'u' });
    let net = false;
    const exec = async (m: QueuedMutation) => {
      if (!net) throw new Error('нет сети');
      sent.push(m.endpoint);
      return m.method === 'POST' ? { ok: true as const, createdId: 'real-1' } : true;
    };
    await offlineQueue.sync(exec, 'u');
    expect(sent).toEqual([]);
    expect(offlineQueue.pendingCount).toBe(2); // отметка не потерялась
    net = true;
    await offlineQueue.sync(exec, 'u');
    expect(sent).toEqual(['/tasks', '/tasks/real-1/complete']);
    expect(offlineQueue.pendingCount).toBe(0);
  });
});
