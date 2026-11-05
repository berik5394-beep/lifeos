import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';

/**
 * Ревью-3 I6: «Подтвердить» на доход по сделке → сервер нашёл такой же доход и
 * спрашивает «Записать ещё раз?» (done:false + pendingAction + confirmationText).
 * Под этим вопросом должны быть кнопки — иначе ответить можно только словами.
 */
const mockApi = api as jest.Mocked<typeof api>;

const ASK = {
  id: 'a1',
  role: 'assistant' as const,
  content: 'Сделка Серик — склад: закрыть как выигранную и записать доход 500 000 ₸?',
  pendingAction: { action: 'record_deal_income', input: { dealId: 'd1', markWon: true, amount: 500_000 } },
  createdAt: '2026-11-06T00:00:00Z',
};

beforeEach(() => {
  useChatStore.setState({ messages: [ASK], isLoading: false, hasMore: true });
  jest.clearAllMocks();
});

describe('подтверждение поставило новый вопрос', () => {
  it('done:false + pendingAction → ответ робота с кнопками «Подтвердить / Отмена»', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Похоже, этот доход уже записан (500 000 ₸ от Серика, 05.11). Записать ещё раз?',
      intent: 'record_deal_income',
      done: false,
      pendingAction: { action: 'record_deal_income', input: { dealId: 'd1', force: true } },
      confirmationText: 'Похоже, этот доход уже записан (500 000 ₸ от Серика, 05.11). Записать ещё раз?',
      emotion: 'neutral',
    });
    await useChatStore.getState().confirmPendingAction('a1', true);
    const [reply, ask] = useChatStore.getState().messages;
    expect(reply.content).toMatch(/Записать ещё раз\?$/);
    expect(reply.pendingAction).toEqual({ action: 'record_deal_income', input: { dealId: 'd1', force: true } });
    expect(ask.pendingAction).toBeNull();

    // вторая кнопка подтверждает именно новый вопрос
    mockApi.post.mockResolvedValueOnce({ message: 'Записал доход 500 000 ₸ — сделка Серик — склад.', intent: 'record_deal_income', done: true });
    await useChatStore.getState().confirmPendingAction(reply.id, true);
    expect(mockApi.post).toHaveBeenLastCalledWith('/voice/confirm-action', { confirm: true, action: 'record_deal_income' }, expect.anything());
    expect(useChatStore.getState().messages[0].pendingAction ?? null).toBeNull();
  });

  it('новый вопрос — слот («Откуда доход?») → без кнопок (ответ словами)', async () => {
    mockApi.post.mockResolvedValueOnce({
      message: 'Откуда доход?',
      done: false,
      pendingAction: { action: 'add_income', input: { amount: 1, __awaitingSource: true } },
      confirmationText: 'Откуда доход?',
    });
    await useChatStore.getState().confirmPendingAction('a1', true);
    expect(useChatStore.getState().messages[0].pendingAction ?? null).toBeNull();
  });

  it('обычное подтверждение (done:true) → без кнопок, как раньше', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Записал доход', intent: 'record_deal_income', done: true });
    await useChatStore.getState().confirmPendingAction('a1', true);
    expect(useChatStore.getState().messages[0].pendingAction ?? null).toBeNull();
  });
});
