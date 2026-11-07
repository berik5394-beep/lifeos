import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';

const mockApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
});

describe('chat-store: подтверждение денежных действий', () => {
  it('sendMessage сохраняет pendingAction у ответа ассистента', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const [assistant] = useChatStore.getState().messages;
    expect(assistant.role).toBe('assistant');
    expect(assistant.pendingAction).toEqual({ action: 'add_expense', input: { amount: 3000 } });
  });

  it('confirmPendingAction: снимает pendingAction и добавляет ответ сервера', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const askId = useChatStore.getState().messages[0].id;

    mockApi.post.mockResolvedValueOnce({ message: 'Записал расход 3000₸', intent: 'add_expense', done: true });
    await useChatStore.getState().confirmPendingAction(askId, true);

    const msgs = useChatStore.getState().messages;
    expect(msgs[0].content).toBe('Записал расход 3000₸');
    expect(msgs.find((m) => m.id === askId)?.pendingAction).toBeNull();
    expect(mockApi.post).toHaveBeenLastCalledWith('/voice/confirm-action', { confirm: true, action: 'add_expense' }, 'test-token-123', { timeoutMs: 60_000 });
  });

  it('слот-вопрос («На что потратил?») — без кнопок (pendingAction не сохраняется)', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'На что потратил 3000₸? (или «отмена»)',
      pendingAction: { action: 'add_expense', input: { amount: 3000, __awaitingCategory: true } },
    });
    await useChatStore.getState().sendMessage('потратил 3000');
    expect(useChatStore.getState().messages[0].pendingAction).toBeNull();
  });

  it('confirmPendingAction при сбое сети: pendingAction остаётся, показана ошибка', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать?',
      pendingAction: { action: 'add_expense', input: { amount: 1 } },
    });
    await useChatStore.getState().sendMessage('потратил 1 на тест');
    const askId = useChatStore.getState().messages[0].id;
    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await useChatStore.getState().confirmPendingAction(askId, true);
    const msgs = useChatStore.getState().messages;
    expect(msgs.find((m) => m.id === askId)?.pendingAction).not.toBeNull();
    expect(msgs[0].content).toMatch(/Не получилось подтвердить/);
  });

  it('новое сообщение юзера снимает кнопки со СТАРЫХ предложений (сервер держит один pending — старая кнопка подтвердила бы чужое)', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const oldAskId = useChatStore.getState().messages[0].id;
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 50000₸ на телефон?',
      pendingAction: { action: 'add_expense', input: { amount: 50000 } },
    });
    await useChatStore.getState().sendMessage('потратил 50000 на телефон');
    const msgs = useChatStore.getState().messages;
    expect(msgs.find((m) => m.id === oldAskId)?.pendingAction).toBeNull();
    expect(msgs[0].pendingAction).toEqual({ action: 'add_expense', input: { amount: 50000 } });
  });

  it('двойное нажатие: второй запрос не уходит (кнопки снимаются сразу)', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать?',
      pendingAction: { action: 'add_expense', input: { amount: 1 } },
    });
    await useChatStore.getState().sendMessage('потратил 1 на тест');
    const askId = useChatStore.getState().messages[0].id;
    mockApi.post.mockResolvedValue({ message: 'Записал', intent: 'add_expense', done: true });
    await Promise.all([
      useChatStore.getState().confirmPendingAction(askId, true),
      useChatStore.getState().confirmPendingAction(askId, true),
    ]);
    const confirmCalls = mockApi.post.mock.calls.filter((c) => c[0] === '/voice/confirm-action');
    expect(confirmCalls).toHaveLength(1);
  });

  it('эмоция робота: sendMessage сохраняет emotion ответа; мусор → neutral', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Готово!', emotion: 'happy' });
    await useChatStore.getState().sendMessage('создай задачу');
    expect(useChatStore.getState().messages[0].emotion).toBe('happy');
    mockApi.post.mockResolvedValueOnce({ message: 'Хм', emotion: 'ecstatic' });
    await useChatStore.getState().sendMessage('что-то');
    expect(useChatStore.getState().messages[0].emotion).toBe('neutral');
  });

  it('«открой задачи»: ответ несёт openPanel — экран откроет панель', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Открываю задачи', openPanel: 'tasks' });
    await useChatStore.getState().sendMessage('открой задачи');
    expect(useChatStore.getState().messages[0].openPanel).toBe('tasks');
    mockApi.post.mockResolvedValueOnce({ message: 'Привет' });
    await useChatStore.getState().sendMessage('привет');
    expect(useChatStore.getState().messages[0].openPanel).toBeNull();
  });
});

describe('chat-store: шторка «История» не теряет кнопки подтверждения', () => {
  it('fetchHistory(0) оставляет локальную копию сообщения (кнопки, id), а старое догружает с сервера', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Записать расход 3000₸ на еду?',
      pendingAction: { action: 'add_expense', input: { amount: 3000 } },
    });
    await useChatStore.getState().sendMessage('потратил 3000 на еду');
    const askId = useChatStore.getState().messages[0].id;
    // Сервер отдаёт историю старым-первым, без pendingAction и со своими id.
    mockApi.get.mockResolvedValueOnce({
      messages: [
        { id: 's0', role: 'assistant', content: 'Привет!', createdAt: '2026-11-05T08:00:00Z' },
        { id: 's1', role: 'user', content: 'потратил 3000 на еду', createdAt: '2026-11-05T09:00:00Z' },
        { id: 's2', role: 'assistant', content: 'Записать расход 3000₸ на еду?', createdAt: '2026-11-05T09:00:01Z' },
      ],
      hasMore: false,
    });
    await useChatStore.getState().fetchHistory(0);
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].id).toBe(askId);
    expect(msgs[0].pendingAction).toEqual({ action: 'add_expense', input: { amount: 3000 } });
    expect(msgs[2]).toMatchObject({ id: 's0', content: 'Привет!' });
  });
});
