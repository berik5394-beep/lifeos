import { navigateTo } from '@/navigation/ref';
import { toolKeyForRoute } from '@/services/panels';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { isToolKey } from '@/services/room-tools';

/**
 * Открыть экран по команде мозга. Инструменты (Задачи, Финансы, Цели…) —
 * вкладка дома, а не старая отдельная шторка с двойной шапкой; остальное
 * (Канбан, Настройки…) — обычный переход.
 */
export function openScreen(
  screen: string,
  navigate: (route: string, params?: object) => void = (r) => navigateTo(r),
  params?: object,
): void {
  const tool = toolKeyForRoute(screen);
  if (isToolKey(tool)) {
    navigateTo('Home');
    useRoomToolStore.getState().openTool(tool);
    return;
  }
  navigate(screen, params);
}
