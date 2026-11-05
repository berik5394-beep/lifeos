/**
 * Робот-эпик, Часть 3: инструменты спрятаны и открываются панелями (шторками)
 * по кнопке или по фразе «покажи задачи» (сервер присылает openPanel).
 * Ключи панелей совпадают с сервером (jarvis-orchestrator PANEL_REPLY).
 */
export interface PanelDef {
  key: string;
  /** Имя маршрута корневого стека навигации. */
  route: string;
  label: string;
  icon: string;
  /** Фича ui-store, без которой панель скрыта (уровень сложности интерфейса). */
  feature?: string;
}

export const PANELS: readonly PanelDef[] = [
  { key: 'today', route: 'Dashboard', label: 'Сегодня', icon: 'sun' },
  { key: 'tasks', route: 'Tasks', label: 'Задачи', icon: 'check-square' },
  { key: 'habits', route: 'Habits', label: 'Привычки', icon: 'repeat' },
  { key: 'goals', route: 'Goals', label: 'Цели', icon: 'target', feature: 'goals_tab' },
  { key: 'finance', route: 'Finance', label: 'Финансы', icon: 'dollar-sign', feature: 'finance_tab' },
  { key: 'calendar', route: 'Calendar', label: 'Календарь', icon: 'calendar' },
  { key: 'journal', route: 'Journal', label: 'Дневник', icon: 'book-open' },
];

export function panelRoute(key: string | null | undefined): string | null {
  return PANELS.find((p) => p.key === key)?.route ?? null;
}

export function visiblePanels(isFeatureVisible: (feature: string) => boolean): PanelDef[] {
  return PANELS.filter((p) => !p.feature || isFeatureVisible(p.feature));
}
