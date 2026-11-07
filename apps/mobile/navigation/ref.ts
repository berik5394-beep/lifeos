import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Навигация вне экранов: общий голос живёт над всем стеком (один микрофон на
 * всё приложение), а «давай поговорим» и «открой задачи» должны работать с
 * любого экрана.
 */
export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

export function navigateTo(route: string): void {
  if (navigationRef.isReady()) navigationRef.navigate(route);
}

/** Текущий экран (или null, пока навигация не готова). */
export function currentRouteName(): string | null {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name ?? null : null;
}
