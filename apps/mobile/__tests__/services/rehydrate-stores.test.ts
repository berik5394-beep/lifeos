jest.unmock('@/services/storage');

import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from '@/services/storage';
import { rehydrateStores } from '@/services/rehydrate-stores';
import { useUIStore } from '@/stores/ui-store';
import { useFocusStore } from '@/stores/focus-store';

/**
 * Berik: «ставлю Продвинутый — после выхода и нового захода снова Стандарт».
 * Стор создаётся до чтения сохранённого (кэш пуст) → «Стандарт»; после
 * storage.load() его надо перечитать — как при запуске приложения.
 */
describe('после перезапуска сохранённые настройки возвращаются', () => {
  it('уровень интерфейса и минуты «Фокуса»', async () => {
    await AsyncStorage.setItem('ui_complexity', 'power');
    await AsyncStorage.setItem('pomodoro_minutes', '50');
    // при импорте сторов кэш был пуст — значения по умолчанию
    expect(useUIStore.getState().complexity).toBe('standard');
    await storage.load();
    rehydrateStores();
    expect(useUIStore.getState().complexity).toBe('power');
    expect(useUIStore.getState().isFeatureVisible('kanban_view')).toBe(true);
    expect(useFocusStore.getState().pomodoroMinutes).toBe(50);
  });
});
