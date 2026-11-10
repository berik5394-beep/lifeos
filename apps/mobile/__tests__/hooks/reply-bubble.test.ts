jest.mock('@/stores/chat-store', () => ({ useChatStore: jest.fn() }));
jest.mock('@/navigation/ref', () => ({ currentRouteName: () => null, navigationRef: { addListener: () => () => {} } }));
import { bubbleReplyFor, threadFor, threadOpen, useReplyBubbleStore } from '@/hooks/use-reply-bubble';
import type { ChatMessage } from '@/stores/chat-store';

/** Berik 2026-11-09: облачко исчезало само и всплывало снова на каждом экране. */
const at = (ms: number) => new Date(ms).toISOString();
const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'a1', role: 'assistant', content: 'Создал задачу', createdAt: at(1000), ...over }) as ChatMessage;

describe('bubbleReplyFor — одно облачко на всё приложение', () => {
  it('ответ пришёл, пока экран перед глазами → показываем', () => {
    expect(bubbleReplyFor(msg({}), null, 500)?.id).toBe('a1');
  });
  it('открыл новый экран ПОСЛЕ ответа → старый ответ не всплывает', () => {
    expect(bubbleReplyFor(msg({}), null, 2000)).toBeUndefined();
  });
  it('убран тапом/смахиванием/уходом → больше нигде', () => {
    expect(bubbleReplyFor(msg({}), 'a1', 0)).toBeUndefined();
  });
  it('вопрос «Подтвердить?» идёт с тобой, пока не ответишь', () => {
    const p = msg({ pendingAction: { action: 'add_expense' } as ChatMessage['pendingAction'] });
    expect(bubbleReplyFor(p, null, 99999)?.id).toBe('a1');
    expect(bubbleReplyFor(p, 'a1', 0)).toBeUndefined();
  });
  it('последнее — сообщение юзера → облачка нет', () => {
    expect(bubbleReplyFor(msg({ role: 'user' }), null, 0)).toBeUndefined();
  });
  it('dismiss общий для всех мест', () => {
    useReplyBubbleStore.getState().dismiss('x9');
    expect(useReplyBubbleStore.getState().dismissedId).toBe('x9');
  });
});

/** Berik 2026-11-10: ответить роботу на его вопрос нельзя — облачко пропадало, контекст терялся. */
describe('облачко-диалог — весь текущий разговор', () => {
  // Стор хранит новые первыми.
  const store = [
    msg({ id: 'a2', content: 'Минус 25 000. Что входит в «Другое»?', createdAt: at(4000) }),
    msg({ id: 'u2', role: 'user', content: 'траты в ноябре', createdAt: at(3000) }),
    msg({ id: 'a1', content: 'старый ответ', createdAt: at(2000) }),
    msg({ id: 'u1', role: 'user', content: 'старый вопрос', createdAt: at(1000) }),
  ];
  it('реплики после границы, старые первыми', () => {
    expect(threadFor(store, 'a1', at(2000)).map((m) => m.id)).toEqual(['u2', 'a2']);
  });
  it('ответил роботу — его вопрос и твой ответ в одном облачке', () => {
    const next = [msg({ id: 'u3', role: 'user', content: 'кафе', createdAt: at(5000) }), ...store];
    expect(threadFor(next, 'a1', at(2000)).map((m) => m.id)).toEqual(['u2', 'a2', 'u3']);
  });
  it('границы нет в списке (история перечитана) — по времени', () => {
    expect(threadFor(store, 'gone', at(2500)).map((m) => m.id)).toEqual(['u2', 'a2']);
  });
  it('старт приложения: только новое', () => {
    expect(threadFor(store, null, at(3500)).map((m) => m.id)).toEqual(['a2']);
  });
  it('держит не больше лимита — самые свежие', () => {
    expect(threadFor(store, null, at(0), 2).map((m) => m.id)).toEqual(['u2', 'a2']);
  });
  it('робот думает (ты только что ответил) — облачко открыто', () => {
    const t = [msg({ id: 'u3', role: 'user', createdAt: at(5000) })];
    expect(threadOpen(t, 99999, true)).toBe(true);
  });
  it('свежая реплика на этом экране — открыто; старая на новом экране — нет', () => {
    const t = threadFor(store, 'a1', at(2000));
    expect(threadOpen(t, 3500, false)).toBe(true);
    expect(threadOpen(t, 9000, false)).toBe(false);
  });
  it('убрал тапом — граница сдвинулась, разговор пуст', () => {
    useReplyBubbleStore.getState().dismiss('a2', { id: 'a2', createdAt: at(4000) });
    const st = useReplyBubbleStore.getState();
    expect(threadFor(store, st.anchorId, st.anchorAt)).toEqual([]);
    expect(threadOpen([], 0, false)).toBe(false);
  });
});
