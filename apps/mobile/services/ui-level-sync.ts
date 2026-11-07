import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore, type UIComplexity } from '@/stores/ui-store';

/**
 * Уровень интерфейса — в аккаунте (User.settings.uiComplexity), телефон —
 * копия для работы без сети. Berik: «ставлю Продвинутый — должно держаться для
 * юзера», в том числе на другом телефоне и после переустановки.
 *
 * Выбор без сети не теряется: помечаем «не отправлено» и дошлём при следующем
 * входе, а не перетрём выбор старым значением с сервера.
 */
const DIRTY_KEY = 'ui_complexity_dirty';
const LEVELS: UIComplexity[] = ['simple', 'standard', 'power'];
const isLevel = (v: unknown): v is UIComplexity => typeof v === 'string' && (LEVELS as string[]).includes(v);

async function push(c: UIComplexity): Promise<boolean> {
  const token = useAuthStore.getState().token;
  if (!token) return false;
  try {
    await api.patch('/auth/profile', { uiComplexity: c }, token);
    storage.remove(DIRTY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Выбор в Настройках/онбординге: сразу на экране, затем в аккаунт. */
export async function chooseUiLevel(c: UIComplexity): Promise<void> {
  useUIStore.getState().setComplexity(c);
  storage.setBoolean(DIRTY_KEY, true);
  await push(c);
}

/**
 * При входе/запуске: в аккаунте есть уровень — применить; нет (или здесь
 * выбрали без сети) — отправить выбранный на этом телефоне.
 */
export async function syncUiLevel(): Promise<void> {
  const token = useAuthStore.getState().token;
  if (!token) return;
  const local = useUIStore.getState().complexity;
  if (storage.getBoolean(DIRTY_KEY)) {
    await push(local);
    return;
  }
  try {
    const me = await api.get<{ user?: { uiComplexity?: unknown } }>('/auth/me', token);
    const remote = me.user?.uiComplexity;
    if (isLevel(remote)) {
      if (remote !== local) useUIStore.getState().setComplexity(remote);
    } else if (remote === null && storage.getString('ui_complexity')) {
      await push(local); // в аккаунте пусто — перенести выбор с этого телефона
    }
  } catch {
    // без сети — остаётся то, что на телефоне
  }
}
