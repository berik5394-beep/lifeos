import { api } from '@/services/api';
import { useTaskStore } from '@/stores/task-store';
import { useEventStore } from '@/stores/event-store';
import { useChatStore } from '@/stores/chat-store';
import { useScheduleStore } from '@/stores/schedule-store';

/**
 * Перегруз дня, этап 3 (мобилка): сохранил задачу/встречу в карточке → сервер
 * вернул proposal → робот показывает его облачком с «Подтвердить / Отмена»;
 * после подтверждения экраны перечитывают график (revision).
 */
const mockApi = api as jest.Mocked<typeof api>;

const TASK = {
  id: 't1',
  userId: 'u',
  title: 'Отчёт',
  category: 'work',
  priority: 'medium',
  date: '2026-11-06',
  time: null,
  completed: false,
  notes: null,
  createdAt: '2026-11-05T00:00:00Z',
};
const PROPOSAL = { text: 'Завтра день перегружен…\nПодтвердить перенос?', staged: true };

beforeEach(() => {
  useTaskStore.setState({ tasks: [], isLoading: false });
  useEventStore.setState({ events: [], upcoming: [], isLoading: false });
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
  useScheduleStore.setState({ revision: 0 });
  jest.clearAllMocks();
});

describe('перегруз дня: предложение из карточки', () => {
  it('createTask с proposal → задача без поля proposal, реплика робота с кнопками', async () => {
    mockApi.post.mockResolvedValueOnce({ ...TASK, proposal: PROPOSAL });
    await useTaskStore.getState().createTask({ title: 'Отчёт', category: 'work', priority: 'medium', date: '2026-11-06' });

    expect(useTaskStore.getState().tasks).toEqual([TASK]);
    const msg = useChatStore.getState().messages[0];
    expect(msg).toMatchObject({ role: 'assistant', kind: 'proposal', content: PROPOSAL.text });
    expect(msg.pendingAction).toEqual({ action: 'apply_reschedule', input: {} });
  });

  it('без proposal → в чат ничего не добавляется', async () => {
    mockApi.post.mockResolvedValueOnce(TASK);
    await useTaskStore.getState().createTask({ title: 'Отчёт', category: 'work', priority: 'medium', date: '2026-11-06' });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('не ждёт подтверждения (staged:false) → реплика без кнопок', async () => {
    mockApi.put.mockResolvedValueOnce({ ...TASK, proposal: { text: 'Сначала ответь на прошлое подтверждение', staged: false } });
    useTaskStore.setState({ tasks: [TASK] });
    await useTaskStore.getState().updateTask('t1', { date: '2026-11-06' });
    expect(useChatStore.getState().messages[0].pendingAction).toBeNull();
    expect(useTaskStore.getState().tasks[0]).not.toHaveProperty('proposal');
  });

  it('«Подтвердить» → confirm с action, ответ виден поверх карточки, экраны перечитывают график', async () => {
    useChatStore.getState().showProposal(PROPOSAL);
    const id = useChatStore.getState().messages[0].id;
    mockApi.post.mockResolvedValueOnce({ message: 'Готово, график сдвинут', intent: 'apply_reschedule', done: true });

    await useChatStore.getState().confirmPendingAction(id, true);

    expect(mockApi.post).toHaveBeenLastCalledWith('/voice/confirm-action', { confirm: true, action: 'apply_reschedule' }, expect.anything(), { timeoutMs: 60_000 });
    expect(useChatStore.getState().messages[0]).toMatchObject({ content: 'Готово, график сдвинут', kind: 'proposal' });
    expect(useScheduleStore.getState().revision).toBe(1);
  });

  it('предложение устарело (409) → график не перечитываем', async () => {
    useChatStore.getState().showProposal(PROPOSAL);
    const id = useChatStore.getState().messages[0].id;
    mockApi.post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await useChatStore.getState().confirmPendingAction(id, true);
    expect(useScheduleStore.getState().revision).toBe(0);
    expect(useChatStore.getState().messages[0].content).toMatch(/устарело/);
    expect(useChatStore.getState().messages.find((m) => m.id === id)?.pendingAction).toBeNull();
  });

  it('новое предложение снимает кнопки со старого (на сервере ждёт одно)', () => {
    useChatStore.getState().showProposal(PROPOSAL);
    useChatStore.getState().showProposal({ ...PROPOSAL, text: 'Второе' });
    const [second, first] = useChatStore.getState().messages;
    expect(second.pendingAction).not.toBeNull();
    expect(first.pendingAction).toBeNull();
  });

  it('createEvent: сервер отдаёт саму встречу → в списке встреча, а не undefined; proposal → облачко', async () => {
    const ev = { id: 'e1', userId: 'u', title: 'Выезд', date: '2026-11-06', startTime: '09:00', endTime: '19:30', location: null, description: null, reminder: 30, source: 'manual', createdAt: '' };
    mockApi.post.mockResolvedValueOnce({ ...ev, proposal: PROPOSAL });
    const res = await useEventStore.getState().createEvent({ title: 'Выезд', date: '2026-11-06', startTime: '09:00', endTime: '19:30' });
    expect(res).toEqual({ event: ev, conflicts: [] });
    expect(useEventStore.getState().events).toEqual([ev]);
    expect(useChatStore.getState().messages[0].kind).toBe('proposal');
  });

  it('quickAdd: сервер отдаёт { task, proposal } → в списке задача (не обёртка), облачко робота', async () => {
    mockApi.post.mockResolvedValueOnce({ task: TASK, parsed: {}, confidence: 0.9, proposal: PROPOSAL });
    await useTaskStore.getState().quickAdd('отчёт завтра');
    expect(useTaskStore.getState().tasks).toEqual([TASK]);
    expect(useChatStore.getState().messages[0].kind).toBe('proposal');
  });

  it('quickAdd офлайн (api вернул {}) → в список ничего не попадает', async () => {
    mockApi.post.mockResolvedValueOnce({});
    await useTaskStore.getState().quickAdd('что-то');
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('updateEvent с proposal → встреча без поля proposal, облачко робота', async () => {
    const ev = { id: 'e1', userId: 'u', title: 'Выезд', date: '2026-11-06', startTime: '09:00', endTime: '19:30', location: null, description: null, reminder: 30, source: 'manual', createdAt: '' };
    useEventStore.setState({ events: [{ ...ev, endTime: '10:00' }] });
    mockApi.put.mockResolvedValueOnce({ ...ev, proposal: PROPOSAL });
    await useEventStore.getState().updateEvent('e1', { endTime: '19:30' });
    expect(useEventStore.getState().events).toEqual([ev]);
    expect(useChatStore.getState().messages[0].kind).toBe('proposal');
  });

  it('история: сервер отдаёт НОВЫЕ первыми → в сторе [0] — последний ответ, предложение с кнопками', async () => {
    useChatStore.getState().showProposal(PROPOSAL);
    mockApi.get.mockResolvedValueOnce([
      { id: 's2', role: 'assistant', content: PROPOSAL.text, createdAt: '2026-11-05T09:00:02Z' },
      { id: 's1', role: 'user', content: 'привет', createdAt: '2026-11-05T09:00:00Z' },
    ]);
    await useChatStore.getState().fetchHistory(0);
    const msgs = useChatStore.getState().messages;
    expect(msgs.map((m) => m.content)).toEqual([PROPOSAL.text, 'привет']);
    expect(msgs[0].pendingAction).toEqual({ action: 'apply_reschedule', input: {} });
  });
});
