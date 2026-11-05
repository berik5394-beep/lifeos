import type { RoomItem, RoomItemKey } from '@/services/room-catalog';

/**
 * Робот-эпик, Часть 5: инструменты живут в мебели комнаты. Робот подходит к
 * предмету и достаёт инструмент; нет такого предмета — достаёт «из воздуха».
 * Чистые функции (jest).
 */
export const TOOL_KEYS = ['today', 'tasks', 'habits', 'goals', 'finance', 'calendar', 'journal'] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

/** Где лежит инструмент (раскладка Berik). */
export const TOOL_HOME: Record<ToolKey, RoomItemKey> = {
  calendar: 'wardrobe',
  goals: 'wardrobe',
  tasks: 'desk',
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
