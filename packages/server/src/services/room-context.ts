import { variantByKey, TIER_LABEL } from './room-catalog.js';

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
  // Часть 5: мебель, из которой робот достаёт инструменты.
  wardrobe: 'шкаф',
  desk: 'стол',
  nightstand: 'тумбочка',
  dresser: 'комод',
  // Часть 6: отделка.
  walls: 'стены',
  floor: 'пол',
  // Робот-друг №4: подарки дружбы.
  aquarium: 'аквариум',
  guitar: 'гитара',
  telescope: 'телескоп',
  trophy: 'кубок дружбы',
  star: 'звезда дружбы',
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

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * Часть 6: строка для мозга по реальным предметам — только то, что СТОИТ в
 * комнате (кладовка не в счёт), с классом ремонта: «Комната робота: шкаф-купе
 * (средний), диван-книжка (бюджет); стены — виниловые обои (средний)».
 * Предметы Части 4 без варианта (ещё не переведены) — по старым названиям.
 */
export function roomContextFromItems(
  rows: Array<{ itemKey: string; variantKey: string | null; slot: string | null }>,
): string | null {
  const furniture: string[] = [];
  const finish: string[] = [];
  const legacy: string[] = [];
  for (const r of rows) {
    const v = variantByKey(r.variantKey);
    if (!v) {
      if (r.variantKey === null) legacy.push(r.itemKey);
      continue;
    }
    if (!r.slot) continue; // в кладовке
    const tier = v.tier === 'free' ? '' : v.tier === 'friend' ? ' (подарок дружбы)' : ` (${lower(TIER_LABEL[v.tier])})`;
    if (v.spot === 'finish') finish.push(`${ROOM_ITEM_LABELS[v.kind as RoomItemKey] ?? v.kind} — ${lower(v.label)}${tier}`);
    else furniture.push(`${lower(v.label)}${tier}`);
  }
  const old = roomContextLine(legacy)?.replace('Комната робота: ', '');
  const parts = [[...furniture, ...(old ? [old] : [])].join(', '), finish.join(', ')].filter(Boolean);
  return parts.length ? `Комната робота: ${parts.join('; ')}` : null;
}
