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
jest.mock('@/services/chat-stream', () => {
  const actual = jest.requireActual('@/services/chat-stream');
  return { ...actual, streamChat: jest.fn() };
});
import { streamChat, StreamUnavailableError, createNdjsonParser } from '@/services/chat-stream';
import { createSentenceSpeaker } from '@/services/sentence-speaker';
const mockStream = streamChat as jest.Mock;
const mockApi = api as jest.Mocked<typeof api>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({ messages: [], isLoading: false, hasMore: true });
});

describe('Джарвис-голос: сказал голосом — ответ вслух', () => {
  it('голос → поток: облачко растёт, фразы звучат сразу, итог совпал — хвост договаривается', async () => {
    mockStream.mockImplementationOnce(async (_t: string, _tok: string, onDelta: (x: string) => void) => {
      onDelta('Сегодня три задачи. ');
      expect(useChatStore.getState().messages[0].content).toBe('Сегодня три задачи. ');
      onDelta('Начни с отчёта');
      return { message: 'Сегодня три задачи. Начни с отчёта', streamed: 'Сегодня три задачи. Начни с отчёта' };
    });
    await useChatStore.getState().sendMessage('что сегодня', true, { spoken: true });
    await flush();
    expect(mockStream).toHaveBeenCalledWith('что сегодня', 'test-token-123', expect.any(Function), { voice: true, webSearch: true });
    expect((Speech.speak as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['Сегодня три задачи.', 'Начни с отчёта']);
    const msgs = useChatStore.getState().messages;
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(msgs[0].content).toBe('Сегодня три задачи. Начни с отчёта');
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('сервер без потока (404) — обычный путь, итог вслух', async () => {
    mockStream.mockRejectedValueOnce(new StreamUnavailableError(404));
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
    mockStream.mockRejectedValueOnce(new ApiError(0, 'Нет интернета'));
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

describe('createSentenceSpeaker — говорить по фразам', () => {
  const mk = () => {
    const said: string[] = [];
    const stop = jest.fn();
    return { said, stop, sp: createSentenceSpeaker((x) => said.push(x), stop) };
  };
  it('фраза уходит в озвучку, как только закончилась', () => {
    const { said, sp } = mk();
    sp.push('Привет, Бер');
    expect(said).toEqual([]);
    sp.push('ик! Сегодня три зад');
    expect(said).toEqual(['Привет, Берик!']);
    sp.push('ачи');
    sp.finish('Привет, Берик! Сегодня три задачи', 'Привет, Берик! Сегодня три задачи');
    expect(said).toEqual(['Привет, Берик!', 'Сегодня три задачи']);
  });
  it('итог другой (подтверждение денег) — замолчать и сказать итог', () => {
    const { said, stop, sp } = mk();
    sp.push('Сейчас запишу. ');
    sp.finish('Записать расход 3000 ₸ на еду?', 'Сейчас запишу. ');
    expect(stop).toHaveBeenCalled();
    expect(said).toEqual(['Сейчас запишу.', 'Записать расход 3000 ₸ на еду?']);
  });
  it('разметку сервер снял с итога — это не «другой» итог', () => {
    const { said, stop, sp } = mk();
    sp.push('**Готово.** ');
    sp.finish('Готово.', '**Готово.** ');
    expect(stop).not.toHaveBeenCalled();
    expect(said).toEqual(['**Готово.**']);
  });
  it('кусков не было (быстрая команда) — итог целиком', () => {
    const { said, sp } = mk();
    sp.finish('Записал задачу.', '');
    expect(said).toEqual(['Записал задачу.']);
  });
});

describe('createNdjsonParser', () => {
  it('строки, пришедшие кусками', () => {
    const got: unknown[] = [];
    const feed = createNdjsonParser((o) => got.push(o));
    feed('{"t":"d","x":"При');
    feed('вет"}\n{"t":"done","message":"Привет","streamed":"Привет"}\n');
    expect(got).toEqual([{ t: 'd', x: 'Привет' }, { t: 'done', message: 'Привет', streamed: 'Привет' }]);
  });
});
