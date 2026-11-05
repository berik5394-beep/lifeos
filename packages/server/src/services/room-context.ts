/**
 * Робот-эпик, Часть 4: комната робота. Каталог бесплатной мебели — общий
 * с мобилкой (apps/mobile/services/room-catalog.ts, те же ключи).
 */
export const ROOM_ITEM_LABELS = {
  plant: 'растение',
  sofa: 'диван',
  picture: 'картина',
  lamp: 'лампа',
  books: 'книги',
  clock: 'часы',
  rug: 'ковёр',
  plush: 'игрушка',
} as const;

export type RoomItemKey = keyof typeof ROOM_ITEM_LABELS;
export const ROOM_ITEM_KEYS = Object.keys(ROOM_ITEM_LABELS) as [RoomItemKey, ...RoomItemKey[]];
export const ROOM_MAX_ITEMS = 30;

export function isRoomItemKey(key: string): key is RoomItemKey {
  return Object.prototype.hasOwnProperty.call(ROOM_ITEM_LABELS, key);
}

/**
 * Строка для контекста мозга: «Комната робота: диван, растение ×2».
 * Порядок — по первому появлению; неизвестные ключи пропускаются; пусто → null.
 */
export function roomContextLine(itemKeys: string[]): string | null {
  const counts = new Map<RoomItemKey, number>();
  for (const k of itemKeys) {
    if (isRoomItemKey(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = [...counts].map(([k, n]) => (n > 1 ? `${ROOM_ITEM_LABELS[k]} ×${n}` : ROOM_ITEM_LABELS[k]));
  return `Комната робота: ${parts.join(', ')}`;
}
