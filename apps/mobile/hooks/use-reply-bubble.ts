import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useChatStore, type ChatMessage } from '@/stores/chat-store';
import { currentRouteName, navigationRef } from '@/navigation/ref';

/**
 * Облачко с ответом робота — ОДНО на всё приложение (Berik 2026-11-09).
 * Раньше его рисовали три места (вкладки, комната, строка на экранах стека),
 * у каждого своё «скрыто» и таймер 9 с: ответ исчезал, не дочитав, а потом
 * всплывал снова на каждом новом экране в течение 90 с.
 *
 * Теперь:
 *  - ответ виден там, где ты сейчас, и держится, пока не тапнешь/смахнёшь;
 *  - ушёл на другой экран/вкладку — облачко закрыто и больше нигде не всплывает;
 *  - вопрос «Подтвердить?» ждёт ответа и идёт с тобой, пока не ответишь.
 */
interface ReplyBubbleState {
  dismissedId: string | null;
  dismiss: (id: string) => void;
}

export const useReplyBubbleStore = create<ReplyBubbleState>((set) => ({
  dismissedId: null,
  dismiss: (id) => set({ dismissedId: id }),
}));

/** Чистое правило показа (тестируется). activeSince — с какого момента этот экран перед глазами. */
export function bubbleReplyFor(
  latest: ChatMessage | undefined,
  dismissedId: string | null,
  activeSince: number,
): ChatMessage | undefined {
  if (!latest || latest.role !== 'assistant') return undefined;
  if (latest.id === dismissedId) return undefined;
  if (latest.pendingAction) return latest;
  return new Date(latest.createdAt).getTime() >= activeSince ? latest : undefined;
}

/**
 * hostKey — «где ты» (null — этот экран сейчас не перед глазами). Смена ключа
 * (другая вкладка/страница/экран) закрывает показанный ответ навсегда.
 */
export function useReplyBubble(hostKey: string | null): { reply: ChatMessage | undefined; dismiss: () => void } {
  const latest = useChatStore((s) => s.messages[0]);
  const dismissedId = useReplyBubbleStore((s) => s.dismissedId);
  const since = useRef(Date.now());
  const shown = useRef<string | null>(null);
  const reply = hostKey ? bubbleReplyFor(latest, dismissedId, since.current) : undefined;
  shown.current = reply && !reply.pendingAction ? reply.id : null;
  useEffect(() => {
    since.current = Date.now();
    return () => {
      const id = shown.current;
      if (id) useReplyBubbleStore.getState().dismiss(id);
    };
  }, [hostKey]);
  return {
    reply,
    dismiss: () => {
      if (reply) useReplyBubbleStore.getState().dismiss(reply.id);
    },
  };
}

/** Имя экрана, который сейчас перед глазами (обновляется при навигации). */
export function useCurrentRoute(): string | null {
  const [route, setRoute] = useState<string | null>(currentRouteName());
  useEffect(() => {
    setRoute(currentRouteName());
    return navigationRef.addListener('state', () => setRoute(currentRouteName()));
  }, []);
  return route;
}
