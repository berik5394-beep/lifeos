import type { RoomItem, RoomItemKey } from '@/services/room-catalog';

/**
 * Робот-эпик, Часть 5: инструменты живут в мебели комнаты. Робот подходит к
 * предмету и достаёт инструмент; нет такого предмета — достаёт «из воздуха».
 * Чистые функции (jest).
 */
export const TOOL_KEYS = ['today', 'tasks', 'deals', 'habits', 'goals', 'finance', 'calendar', 'journal'] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

/** Где лежит инструмент (раскладка Berik). */
export const TOOL_HOME: Record<ToolKey, RoomItemKey> = {
  calendar: 'wardrobe',
  goals: 'wardrobe',
  tasks: 'desk',
  deals: 'desk',
  journal: 'nightstand',
  habits: 'nightstand',
  finance: 'dresser',
  today: 'clock',
};

export function isToolKey(key: string | null | undefined): key is ToolKey {
  return !!key && (TOOL_KEYS as readonly string[]).includes(key);
}

/** Какие инструменты лежат в предмете (порядок как в TOOL_KEYS). */
export function toolsInItem(itemKey: RoomItemKey): ToolKey[] {
  return TOOL_KEYS.filter((t) => TOOL_HOME[t] === itemKey);
}

/**
 * Из какого предмета достать инструмент: ближайший к роботу предмет нужного
 * типа; нет такого — null (достаём «из воздуха» рядом с роботом).
 */
export function toolSource(
  tool: ToolKey,
  items: readonly RoomItem[],
  robot: { x: number; y: number },
): RoomItem | null {
  const home = TOOL_HOME[tool];
  let best: RoomItem | null = null;
  let bestD = Infinity;
  for (const it of items) {
    if (it.itemKey !== home) continue;
    const d = (it.x - robot.x) ** 2 + (it.y - robot.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/**
 * Тап по мебели, в которой нет видимого инструмента: раньше — тишина. Робот
 * объясняет: вкладка скрыта в настройках, или предмет просто для уюта.
 * titles — названия инструментов (TOOL_TITLE), label — название предмета.
 */
export function furnitureTapNote(
  itemKey: RoomItemKey,
  label: string,
  visible: readonly string[],
  titles: Record<ToolKey, string>,
): string | null {
  const inside = toolsInItem(itemKey);
  if (inside.some((t) => visible.includes(t))) return null;
  if (inside.length > 0) {
    const names = inside.map((t) => `«${titles[t]}»`).join(' и ');
    return `Здесь — ${names}, но вкладка скрыта. Включить можно в Настройках.`;
  }
  return `${label} — просто для уюта. Инструменты лежат в шкафу, столе, тумбочке, комоде и часах.`;
}
