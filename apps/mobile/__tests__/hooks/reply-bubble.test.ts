jest.mock('@/stores/chat-store', () => ({ useChatStore: jest.fn() }));
jest.mock('@/navigation/ref', () => ({ currentRouteName: () => null, navigationRef: { addListener: () => () => {} } }));
import { bubbleReplyFor, useReplyBubbleStore } from '@/hooks/use-reply-bubble';
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
