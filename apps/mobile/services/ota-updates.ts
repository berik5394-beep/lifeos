import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

/** Не дёргать сервер обновлений чаще (возвраты в приложение бывают каждую минуту). */
const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Обновления «по воздуху» доходят без ожидания. Сам expo-updates проверяет их
 * только при холодном запуске и включает на СЛЕДУЮЩЕМ холодном запуске, а
 * iPhone приложение почти не закрывает — правка шла бы к людям днями.
 *
 * Здесь: при возврате в приложение — тихо проверить и скачать; когда человек
 * ушёл с экрана (фон) и обновление скачано — перезапустить JS. Вернётся он уже
 * в новую версию, ничего не прерывая на глазах. В разработке (Metro) выключено.
 */
export function startOtaUpdates(deps: { updates?: typeof Updates; appState?: typeof AppState; now?: () => number } = {}): () => void {
  const U = deps.updates ?? Updates;
  const appState = deps.appState ?? AppState;
  const now = deps.now ?? Date.now;
  if (__DEV__ || !U.isEnabled) return () => {};

  let ready = false;
  let busy = false;
  let lastCheck = 0;

  const check = async () => {
    if (busy || ready || now() - lastCheck < CHECK_EVERY_MS) return;
    busy = true;
    lastCheck = now();
    try {
      const res = await U.checkForUpdateAsync();
      if (res.isAvailable) {
        const fetched = await U.fetchUpdateAsync();
        ready = fetched.isNew;
      }
    } catch {
      // Нет сети / сервер обновлений недоступен — работаем на текущей версии.
    } finally {
      busy = false;
    }
  };

  const onChange = (s: AppStateStatus) => {
    if (s === 'active') void check();
    else if (s === 'background' && ready) {
      ready = false;
      U.reloadAsync().catch(() => {});
    }
  };

  void check();
  const sub = appState.addEventListener('change', onChange);
  return () => sub.remove();
}
