import { useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Граница разговора (Berik 2026-11-10: ответить роботу на его вопрос нельзя —
   * облачко пропадало, контекст терялся): всё, что НОВЕЕ этого сообщения, —
   * текущий диалог в облачке. Тап/смахивание/уход с экрана двигает границу.
   */
  anchorId: string | null;
  anchorAt: string;
  dismiss: (id: string, anchor?: { id: string; createdAt: string }) => void;
}

const APP_START = new Date().toISOString();

export const useReplyBubbleStore = create<ReplyBubbleState>((set) => ({
  dismissedId: null,
  anchorId: null,
  anchorAt: APP_START,
  dismiss: (id, anchor) =>
    set(anchor ? { dismissedId: id, anchorId: anchor.id, anchorAt: anchor.createdAt } : { dismissedId: id }),
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

/** Сколько реплик держит облачко-диалог (листается вверх до начала разговора). */
export const THREAD_LIMIT = 40;

/**
 * Текущий диалог: сообщения новее границы, СТАРЫЕ ПЕРВЫМИ (стор хранит новые
 * первыми). Граница ищется по id; нет такого id (история перечитана с сервера) —
 * по времени.
 */
export function threadFor(
  messages: ChatMessage[],
  anchorId: string | null,
  anchorAt: string,
  limit = THREAD_LIMIT,
): ChatMessage[] {
  const idx = anchorId ? messages.findIndex((m) => m.id === anchorId) : -1;
  const fresh = idx >= 0 ? messages.slice(0, idx) : messages.filter((m) => m.createdAt > anchorAt);
  return fresh.slice(0, limit).reverse();
}

/**
 * Открыто ли облачко-диалог на этом экране: робот думает; ждёт «Подтвердить?»;
 * последняя реплика пришла, пока экран перед глазами.
 */
export function threadOpen(thread: ChatMessage[], activeSince: number, loading: boolean): boolean {
  if (loading) return true;
  const newest = thread[thread.length - 1];
  if (!newest) return false;
  if (newest.pendingAction) return true;
  return new Date(newest.createdAt).getTime() >= activeSince;
}

/**
 * hostKey — «где ты» (null — этот экран сейчас не перед глазами). Смена ключа
 * (другая вкладка/страница/экран) закрывает разговор.
 */
/**
 * Ответ, который сам сменил экран («Открой финансы» → вкладка открылась): его не
 * закрываем при смене экрана, а несём на новый (аудит 2026-11-09: облачко мигало
 * и пропадало — прочитать ответ можно было только в истории). Общий на все
 * экраны: страница «комната → инструменты» — другой экземпляр хука.
 */
const CARRY_MS = 5000;
let carried: { id: string; createdAt: number } | null = null;

export function useReplyBubble(hostKey: string | null): {
  /** Последний ответ робота (эмоция, кнопки «Подтвердить»), если он — последняя реплика. */
  reply: ChatMessage | undefined;
  /** Весь текущий разговор, старые первыми. */
  thread: ChatMessage[];
  /** Облачко-диалог видно на этом экране. */
  open: boolean;
  dismiss: () => void;
} {
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.isLoading);
  const anchorId = useReplyBubbleStore((s) => s.anchorId);
  const anchorAt = useReplyBubbleStore((s) => s.anchorAt);
  const since = useRef(Date.now());
  const shown = useRef<{ id: string; createdAt: string } | null>(null);
  const thread = useMemo(() => threadFor(messages, anchorId, anchorAt), [messages, anchorId, anchorAt]);
  const open = !!hostKey && threadOpen(thread, since.current, loading);
  const newest = thread[thread.length - 1];
  const reply = open && newest?.role === 'assistant' ? newest : undefined;
  // Вопрос «Подтвердить?» уходом с экрана не закрываем — идёт с тобой.
  shown.current = open && newest && !newest.pendingAction ? { id: newest.id, createdAt: newest.createdAt } : null;
  useEffect(() => {
    const c = carried;
    carried = null;
    since.current = c && hostKey ? Math.min(Date.now(), c.createdAt) : Date.now();
    return () => {
      const s = shown.current;
      if (!s) return;
      const at = new Date(s.createdAt).getTime();
      // Только что пришёл и, видимо, сам открыл этот экран — несём дальше.
      if (newestIsAssistant(s.id) && Date.now() - at < CARRY_MS) {
        carried = { id: s.id, createdAt: at };
        return;
      }
      useReplyBubbleStore.getState().dismiss(s.id, s);
    };
  }, [hostKey]);
  return {
    reply,
    thread,
    open,
    dismiss: () => {
      const last = useChatStore.getState().messages[0] ?? newest;
      if (last) useReplyBubbleStore.getState().dismiss(last.id, { id: last.id, createdAt: last.createdAt });
    },
  };
}

function newestIsAssistant(id: string): boolean {
  const m = useChatStore.getState().messages.find((x) => x.id === id);
  return m?.role === 'assistant';
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
