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
/**
 * Ответ, который сам сменил экран («Открой финансы» → вкладка открылась): его не
 * закрываем при смене экрана, а несём на новый (аудит 2026-11-09: облачко мигало
 * и пропадало — прочитать ответ можно было только в истории). Общий на все
 * экраны: страница «комната → инструменты» — другой экземпляр хука.
 */
const CARRY_MS = 5000;
let carried: { id: string; createdAt: number } | null = null;

export function useReplyBubble(hostKey: string | null): { reply: ChatMessage | undefined; dismiss: () => void } {
  const latest = useChatStore((s) => s.messages[0]);
  const dismissedId = useReplyBubbleStore((s) => s.dismissedId);
  const since = useRef(Date.now());
  const shown = useRef<{ id: string; createdAt: number } | null>(null);
  const reply = hostKey ? bubbleReplyFor(latest, dismissedId, since.current) : undefined;
  shown.current = reply && !reply.pendingAction ? { id: reply.id, createdAt: new Date(reply.createdAt).getTime() } : null;
  useEffect(() => {
    const c = carried;
    carried = null;
    since.current = c && hostKey ? Math.min(Date.now(), c.createdAt) : Date.now();
    return () => {
      const s = shown.current;
      if (!s) return;
      // Только что пришёл и, видимо, сам открыл этот экран — несём дальше.
      if (Date.now() - s.createdAt < CARRY_MS) {
        carried = s;
        return;
      }
      useReplyBubbleStore.getState().dismiss(s.id);
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
