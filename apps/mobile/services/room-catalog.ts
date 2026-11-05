/**
 * Робот-эпик, Часть 4: бесплатная мебель для комнаты робота. Ключи совпадают
 * с серверным каталогом (packages/server/src/services/room-context.ts).
 */
export const ROOM_CATALOG = [
  { key: 'plant', emoji: '🪴', label: 'Растение', spot: 'floor' },
  { key: 'sofa', emoji: '🛋️', label: 'Диван', spot: 'floor' },
  { key: 'picture', emoji: '🖼️', label: 'Картина', spot: 'wall' },
  { key: 'lamp', emoji: '💡', label: 'Лампа', spot: 'floor' },
  { key: 'books', emoji: '📚', label: 'Книги', spot: 'floor' },
  { key: 'clock', emoji: '🕰️', label: 'Часы', spot: 'wall' },
  { key: 'rug', emoji: '🟫', label: 'Ковёр', spot: 'floor' },
  { key: 'plush', emoji: '🧸', label: 'Игрушка', spot: 'floor' },
  // Часть 5: мебель, из которой робот достаёт инструменты (пока эмодзи-заглушки).
  { key: 'wardrobe', emoji: '🗄️', label: 'Шкаф', spot: 'floor' },
  { key: 'desk', emoji: '🪑', label: 'Стол', spot: 'floor' },
  { key: 'nightstand', emoji: '🗃️', label: 'Тумбочка', spot: 'floor' },
  { key: 'dresser', emoji: '🧰', label: 'Комод', spot: 'floor' },
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

/**
 * Куда ставить новый предмет (доли сцены): картины и часы — на заднюю стену,
 * мебель — на пол (3D-комната: стена 0.2..0.6, пол ниже).
 */
export function defaultSpot(key: RoomItemKey): { x: number; y: number } {
  const spot = ROOM_CATALOG.find((i) => i.key === key)?.spot ?? 'floor';
  return spot === 'wall' ? { x: 0.5, y: 0.38 } : { x: 0.5, y: 0.78 };
}

export function clampToRoom(x: number, y: number): { x: number; y: number } {
  return { x: clamp01(x), y: clamp01(y) };
}
