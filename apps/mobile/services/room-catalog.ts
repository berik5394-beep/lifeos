/**
 * Робот-эпик, Часть 4: бесплатная мебель для комнаты робота. Ключи совпадают
 * с серверным каталогом (packages/server/src/services/room-context.ts).
 */
export const ROOM_CATALOG = [
  { key: 'plant', emoji: '🪴', label: 'Растение' },
  { key: 'sofa', emoji: '🛋️', label: 'Диван' },
  { key: 'picture', emoji: '🖼️', label: 'Картина' },
  { key: 'lamp', emoji: '💡', label: 'Лампа' },
  { key: 'books', emoji: '📚', label: 'Книги' },
  { key: 'clock', emoji: '🕰️', label: 'Часы' },
  { key: 'rug', emoji: '🟫', label: 'Ковёр' },
  { key: 'plush', emoji: '🧸', label: 'Игрушка' },
] as const;

export type RoomItemKey = (typeof ROOM_CATALOG)[number]['key'];

export interface RoomItem {
  id: string;
  itemKey: RoomItemKey;
  /** Доли комнаты 0..1 (центр предмета). */
  x: number;
  y: number;
}

export const ROOM_MAX_ITEMS = 30;

const KEYS = new Set<string>(ROOM_CATALOG.map((i) => i.key));

export function isRoomItemKey(key: string): key is RoomItemKey {
  return KEYS.has(key);
}

export function roomItemEmoji(key: string): string {
  return ROOM_CATALOG.find((i) => i.key === key)?.emoji ?? '';
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function clampToRoom(x: number, y: number): { x: number; y: number } {
  return { x: clamp01(x), y: clamp01(y) };
}
