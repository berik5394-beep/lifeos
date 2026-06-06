import { getCalendars } from 'expo-localization';

/**
 * Настоящий IANA-пояс устройства («Asia/Almaty»). Синхронно, всегда свежо
 * на каждый вызов → перелёт подхватывается без слушателя AppState (ОС сама
 * меняет пояс по сети/GPS). Фолбэк-цепь: expo-localization → Intl → 'UTC'.
 */
export function getDeviceTimezone(): string {
  try {
    const tz = getCalendars()?.[0]?.timeZone;
    if (tz) return tz;
  } catch {
    // expo-localization недоступен — пробуем Intl
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // нет ICU — последний фолбэк
  }
  return 'UTC';
}
