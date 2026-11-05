import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { panelRoute } from '@/services/panels';
import { useUIStore } from '@/stores/ui-store';
import { useRoomToolStore } from '@/stores/room-tool-store';

/**
 * Робот-эпик, Часть 3: голосом «открой задачи» → сервер присылает openPanel →
 * открываем панель-шторку. Один раз на ответ (по ссылке на объект результата);
 * скрытая уровнем интерфейса панель не открывается.
 */
export function useOpenPanel(result: { openPanel?: string | null } | null | undefined): void {
  const navigation = useNavigation();
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  const handled = useRef<object | null>(result ?? null);

  useEffect(() => {
    if (!result || handled.current === result) return;
    handled.current = result;
    const route = panelRoute(result.openPanel, isFeatureVisible);
    if (!route) return;
    // Часть 5: инструменты живут в комнате — возвращаемся туда, робот достаёт нужный.
    navigation.navigate('Home' as never);
    useRoomToolStore.getState().openTool(result.openPanel);
  }, [result, navigation, isFeatureVisible]);
}
