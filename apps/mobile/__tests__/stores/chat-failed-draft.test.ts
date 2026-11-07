import { api, ApiError } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';

/**
 * Строка «Скажи роботу» очищается сразу при отправке. Если сообщение не
 * дошло (нет сети, сбой) — текст возвращается в ту строку, что отправила,
 * чтобы не набирать заново. 408 (сервер ещё думает) — не возвращаем: повтор
 * мог бы выполнить команду дважды.
 */
const mockApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  useChatStore.setState({ messages: [], isLoading: false, failedDraft: null, draftOwner: null });
  jest.clearAllMocks();
});

it('нет сети → текст ждёт свою строку ввода', async () => {
  mockApi.post.mockRejectedValueOnce(new ApiError(0, 'Нет подключения к интернету'));
  useChatStore.setState({ draftOwner: 'row-a' });
  await useChatStore.getState().sendMessage('купить хлеб завтра', true);
  expect(useChatStore.getState().takeFailedDraft('row-b')).toBeNull();
  expect(useChatStore.getState().takeFailedDraft('row-a')).toBe('купить хлеб завтра');
  expect(useChatStore.getState().takeFailedDraft('row-a')).toBeNull();
});

it('408 «думаю дольше» → не возвращаем (иначе дубль)', async () => {
  mockApi.post.mockRejectedValueOnce(new ApiError(408, 'Думаю дольше обычного'));
  await useChatStore.getState().sendMessage('потратил 3000', true);
  expect(useChatStore.getState().failedDraft).toBeNull();
});

it('успех → ничего не возвращаем', async () => {
  mockApi.post.mockResolvedValueOnce({ message: 'Готово' });
  await useChatStore.getState().sendMessage('привет', true);
  expect(useChatStore.getState().failedDraft).toBeNull();
});
