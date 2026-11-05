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
    expect(mockApi.post).toHaveBeenLastCalledWith('/voice/confirm-action', { confirm: true }, 'test-token-123');
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
});
