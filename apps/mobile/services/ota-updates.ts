import { AppState, type AppStateStatus } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type * as UpdatesModule from 'expo-updates';

type Updates = typeof UpdatesModule;

/**
 * expo-updates — нативный модуль. В сборке без него (старая dev-сборка
 * симулятора, сборки до №13) жёсткий import ронял приложение при запуске
 * («Cannot find native module 'ExpoUpdates'»). Грузим мягко: нет модуля —
 * обновления по воздуху просто выключены.
 */
function loadUpdates(): Updates | null {
  // Сначала спросить, есть ли нативный модуль: require('expo-updates') без
  // него падает при загрузке модуля (в dev это красный экран, даже под try).
  if (!requireOptionalNativeModule('ExpoUpdates')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-updates') as Updates;
  } catch {
    return null;
  }
}

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
export function startOtaUpdates(deps: { updates?: Updates; appState?: typeof AppState; now?: () => number } = {}): () => void {
  const U = deps.updates ?? loadUpdates();
  if (!U) return () => {};
  const appState = deps.appState ?? AppState;
  const now = deps.now ?? Date.now;
  if (__DEV__ || !U.isEnabled) return () => {};

  let ready = false;
  let busy = false;
  let lastCheck = Number.NEGATIVE_INFINITY; // первая проверка — сразу

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
