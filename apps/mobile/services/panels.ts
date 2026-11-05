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
  /** Панель есть, только если сервер её отдаёт (флаг выключен → 404 → панели нет). */
  serverGated?: boolean;
}

/**
 * Что сказал сервер о функциях за флагами (deal-store: GET /deals ответил 404 → false,
 * ещё не знаем → null: панель прячем, чтобы не мигала у тех, у кого функция выключена).
 * Не передано (undefined) — без серверной проверки.
 */
export interface ServerAvailability {
  dealsAvailable?: boolean | null;
}

export const PANELS: readonly PanelDef[] = [
  { key: 'today', route: 'Dashboard', label: 'Сегодня', icon: 'sun' },
  { key: 'tasks', route: 'Tasks', label: 'Задачи', icon: 'check-square' },
  { key: 'deals', route: 'Deals', label: 'Сделки', icon: 'briefcase', serverGated: true },
  { key: 'habits', route: 'Habits', label: 'Привычки', icon: 'repeat' },
  { key: 'goals', route: 'Goals', label: 'Цели', icon: 'target', feature: 'goals_tab' },
  { key: 'finance', route: 'Finance', label: 'Финансы', icon: 'dollar-sign', feature: 'finance_tab' },
  { key: 'calendar', route: 'Calendar', label: 'Календарь', icon: 'calendar' },
  { key: 'journal', route: 'Journal', label: 'Дневник', icon: 'book-open' },
];

/**
 * Маршрут панели по ключу с сервера. Панель, скрытая уровнем интерфейса
 * (ui-store), не зарегистрирована в навигации → null (не открываем).
 */
export function panelRoute(
  key: string | null | undefined,
  isFeatureVisible: (feature: string) => boolean = () => true,
  server: ServerAvailability = {},
): string | null {
  const panel = PANELS.find((p) => p.key === key);
  if (!panel || !isPanelVisible(panel, isFeatureVisible, server)) return null;
  return panel.route;
}

function isPanelVisible(p: PanelDef, isFeatureVisible: (feature: string) => boolean, server: ServerAvailability): boolean {
  if (p.feature && !isFeatureVisible(p.feature)) return false;
  return !p.serverGated || server.dealsAvailable === undefined || server.dealsAvailable === true;
}

export function visiblePanels(isFeatureVisible: (feature: string) => boolean, server: ServerAvailability = {}): PanelDef[] {
  return PANELS.filter((p) => isPanelVisible(p, isFeatureVisible, server));
}
