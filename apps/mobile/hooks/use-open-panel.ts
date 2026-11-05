import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { panelRoute } from '@/services/panels';
import { useUIStore } from '@/stores/ui-store';

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
    if (route) navigation.navigate(route as never);
  }, [result, navigation, isFeatureVisible]);
}
