import { Linking } from 'react-native';
import { navigationRef } from '@/navigation/ref';
import { useAuthStore } from '@/stores/auth-store';

/**
 * «Привет Siri, ЛайфОС» без рук (jarvis-roadmap №5): команда Siri открывает
 * ссылку lifeos://talk — приложение сразу включает разговор (слушает, отвечает
 * голосом, снова слушает). Нативного кода не нужно: схема lifeos уже в сборке.
 */
export function isTalkLink(url: string | null | undefined): boolean {
  if (!url) return false;
  const m = url.trim().toLowerCase().match(/^lifeos:\/\/\/?([a-z-]+)/);
  return !!m && (m[1] === 'talk' || m[1] === 'voice');
}

const READY_WAIT_MS = 10_000;
const READY_POLL_MS = 200;

/** Открыть разговор, когда навигация готова и человек вошёл (иначе — ничего). */
function openTalkWhenReady(started = Date.now()): void {
  if (navigationRef.isReady() && useAuthStore.getState().token) {
    if (navigationRef.getCurrentRoute()?.name !== 'VoiceConversation') navigationRef.navigate('VoiceConversation' as never);
    return;
  }
  if (Date.now() - started > READY_WAIT_MS) return;
  setTimeout(() => openTalkWhenReady(started), READY_POLL_MS);
}

/** Слушать ссылки: та, что открыла приложение, и приходящие, пока оно открыто. */
export function startTalkLinks(): () => void {
  Linking.getInitialURL()
    .then((url) => {
      if (isTalkLink(url)) openTalkWhenReady();
    })
    .catch(() => {});
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (isTalkLink(url)) openTalkWhenReady();
  });
  return () => sub.remove();
}
