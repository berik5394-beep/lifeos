import { useThemeStore } from '@/stores/theme-store';
import { useUIStore } from '@/stores/ui-store';
import { useFocusStore } from '@/stores/focus-store';
import { useSubscriptionStore } from '@/stores/subscription-store';

/**
 * Сторы, которые читают сохранённое из storage, создаются ДО storage.load()
 * (при импорте модуля, кэш ещё пуст) — и берут значения по умолчанию.
 * Поэтому после load() каждому нужен rehydrate(). Раньше его звала только
 * тема: «Уровень интерфейса» (Berik: «ставлю Продвинутый — после перезахода
 * снова Стандарт»), минуты «Фокуса» и счётчик голоса за день сбрасывались
 * при каждом запуске. Новый стор с сохранением — добавь сюда.
 */
export function rehydrateStores(): void {
  useThemeStore.getState().rehydrate();
  useUIStore.getState().rehydrate();
  useFocusStore.getState().rehydrate();
  useSubscriptionStore.getState().rehydrate();
}
