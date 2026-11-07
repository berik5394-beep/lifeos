import * as Speech from 'expo-speech';
import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';
import { speakableText } from '@/services/tts-voice';
import { isTalkLink } from '@/services/talk-link';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  getAvailableVoicesAsync: jest.fn(async () => []),
}));
const mockApi = api as jest.Mocked<typeof api>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
});

describe('Джарвис-голос: сказал голосом — ответ вслух', () => {
  it('голос → сервер получает voice:true, ответ озвучивается', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Записал задачу на завтра 👍 https://x.y' });
    await useChatStore.getState().sendMessage('создай задачу купить хлеб', true, { spoken: true });
    await flush();
    expect(mockApi.post).toHaveBeenCalledWith('/voice/chat', { text: 'создай задачу купить хлеб', webSearch: true, voice: true }, 'test-token-123', expect.anything());
    expect(Speech.speak).toHaveBeenCalledWith('Записал задачу на завтра', expect.objectContaining({ language: 'ru-RU' }));
  });

  it('напечатанное — без voice и без озвучки (как раньше)', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Готово' });
    await useChatStore.getState().sendMessage('создай задачу', true);
    await flush();
    expect(mockApi.post).toHaveBeenCalledWith('/voice/chat', { text: 'создай задачу', webSearch: true }, 'test-token-123', expect.anything());
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('ошибка сети при голосе — честный текст тоже вслух', async () => {
    const { ApiError } = jest.requireActual('@/services/api');
    mockApi.post.mockRejectedValueOnce(new ApiError(0, 'Нет интернета'));
    await useChatStore.getState().sendMessage('привет', true, { spoken: true });
    await flush();
    expect(Speech.speak).toHaveBeenCalledWith('Нет интернета', expect.anything());
  });
});

describe('speakableText', () => {
  it('без эмодзи, ссылок, разметки', () => {
    expect(speakableText('**Готово!** 🎉 Смотри https://lifeos.app')).toBe('Готово! Смотри');
  });
  it('длинное — до конца предложения', () => {
    const t = speakableText(`${'Первое предложение. '.repeat(10)}Хвост без точки`, 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith('.')).toBe(true);
  });
});

describe('isTalkLink — ссылка для команды Siri', () => {
  it.each(['lifeos://talk', 'LIFEOS://talk', 'lifeos:///talk', 'lifeos://voice'])('%s → разговор', (u) => expect(isTalkLink(u)).toBe(true));
  it.each(['lifeos://settings', 'https://lifeos.app/talk', '', null])('%s → нет', (u) => expect(isTalkLink(u)).toBe(false));
});
