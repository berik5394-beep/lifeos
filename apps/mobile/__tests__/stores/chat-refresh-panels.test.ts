import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';
import { useScheduleStore } from '@/stores/schedule-store';

/**
 * Микрофон теперь один — у поля ввода. Сказал «отметь тренировку» при открытой
 * панели «Привычки» → после ответа мозга открытые экраны перечитывают данные.
 */
const mockApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
  useScheduleStore.setState({ revision: 0 });
  jest.clearAllMocks();
});

it('ответ робота → открытые панели перечитывают данные', async () => {
  mockApi.post.mockResolvedValueOnce({ message: 'Отметил тренировку' });
  await useChatStore.getState().sendMessage('отметь тренировку', true);
  expect(useScheduleStore.getState().revision).toBe(1);
});

