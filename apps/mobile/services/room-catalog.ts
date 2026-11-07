/**
 * Робот-эпик, Части 4–6: комната робота. Цены и варианты — SSOT на сервере
 * (GET /room/catalog, packages/server/src/services/room-catalog.ts); здесь —
 * то, что нужно только экрану: виды предметов (значок, падеж для благодарности),
 * координаты ячеек на рисунке комнаты и чистая логика «защёлкнуть в ячейку».
 */

/** Виды предметов. Ключи совпадают с серверными RoomItem.itemKey. */
export const ROOM_CATALOG = [
  { key: 'walls', emoji: '🧱', label: 'Стены', acc: 'новые стены', spot: 'finish' },
  { key: 'floor', emoji: '🟫', label: 'Пол', acc: 'новый пол', spot: 'finish' },
  { key: 'wardrobe', emoji: '🗄️', label: 'Шкаф', acc: 'шкаф', spot: 'floor' },
  { key: 'desk', emoji: '🪑', label: 'Стол', acc: 'стол', spot: 'floor' },
  { key: 'nightstand', emoji: '🗃️', label: 'Тумбочка', acc: 'тумбочку', spot: 'floor' },
  { key: 'dresser', emoji: '🧰', label: 'Комод', acc: 'комод', spot: 'floor' },
  { key: 'clock', emoji: '🕰️', label: 'Часы', acc: 'часы', spot: 'wall' },
  { key: 'sofa', emoji: '🛋️', label: 'Диван', acc: 'диван', spot: 'floor' },
  { key: 'lamp', emoji: '💡', label: 'Свет', acc: 'свет', spot: 'floor' },
  { key: 'rug', emoji: '🧶', label: 'Ковёр', acc: 'ковёр', spot: 'floor' },
  { key: 'plant', emoji: '🪴', label: 'Растение', acc: 'растение', spot: 'floor' },
  { key: 'picture', emoji: '🖼️', label: 'Картина', acc: 'картину', spot: 'wall' },
  { key: 'books', emoji: '📚', label: 'Книги', acc: 'книги', spot: 'floor' },
  { key: 'plush', emoji: '🧸', label: 'Игрушка', acc: 'игрушку', spot: 'floor' },
] as const;

export type RoomItemKey = (typeof ROOM_CATALOG)[number]['key'];
export type RoomSpot = 'floor' | 'wall' | 'finish';
export type RoomTier = 'budget' | 'mid' | 'premium' | 'luxury';
export type RoomVariantTier = RoomTier | 'free';

export const ROOM_TIERS: readonly RoomTier[] = ['budget', 'mid', 'premium', 'luxury'];
export const TIER_LABEL: Record<RoomVariantTier, string> = {
  budget: 'Бюджет',
  mid: 'Средний',
  premium: 'Премиум',
  luxury: 'Люкс',
  free: 'Декор',
};

/** Цвет «класса» вокруг предмета: серый, синий, золотой, фиолетово-золотой. */
export const TIER_COLOR: Record<RoomTier, { frame: string; stand: string }> = {
  budget: { frame: '#9AA0A6', stand: 'rgba(154,160,166,0.35)' },
  mid: { frame: '#3B82F6', stand: 'rgba(59,130,246,0.35)' },
  premium: { frame: '#D4A017', stand: 'rgba(212,160,23,0.4)' },
  luxury: { frame: '#E6C35C', stand: 'rgba(139,92,246,0.55)' },
};

/** Вариант из серверного каталога (GET /room/catalog). */
export interface RoomVariant {
  key: string;
  kind: RoomItemKey;
  tier: RoomVariantTier;
  label: string;
  emoji: string;
  price: number;
  spot: RoomSpot;
}

export const FLOOR_SLOTS = [
  'floor-back-left',
  'floor-back-center',
  'floor-back-right',
  'floor-mid-left',
  'floor-mid-right',
  'floor-front-left',
  'floor-front-right',
] as const;
export const WALL_SLOTS = ['wall-left', 'wall-center', 'wall-right'] as const;
export type PlaceSlot = (typeof FLOOR_SLOTS)[number] | (typeof WALL_SLOTS)[number];
export type RoomSlot = PlaceSlot | 'finish-walls' | 'finish-floor';

/**
 * Где ячейка на рисунке комнаты (доли сцены, центр предмета). Подобрано под
 * диораму: задняя стена 0.2..0.8 × 0.2..0.56 (ковёр слева, окно справа),
 * пол ниже; центр низа — место робота, его не занимаем.
 */
export const SLOT_POS: Record<PlaceSlot, { x: number; y: number }> = {
  'floor-back-left': { x: 0.31, y: 0.64 },
  'floor-back-center': { x: 0.5, y: 0.63 },
  'floor-back-right': { x: 0.69, y: 0.64 },
  'floor-mid-left': { x: 0.2, y: 0.76 },
  'floor-mid-right': { x: 0.8, y: 0.76 },
  'floor-front-left': { x: 0.13, y: 0.9 },
  'floor-front-right': { x: 0.87, y: 0.9 },
  'wall-left': { x: 0.13, y: 0.42 },
  'wall-center': { x: 0.5, y: 0.26 },
  'wall-right': { x: 0.87, y: 0.42 },
};

/** Купленный предмет (как отдаёт сервер). slot = null — в кладовке. */
export interface OwnedItem {
  id: string;
  itemKey: RoomItemKey;
  variantKey: string | null;
  slot: RoomSlot | null;
}

/** Предмет на рисунке: координаты выводятся из ячейки. */
export interface RoomItem {
  id: string;
  itemKey: RoomItemKey;
  /** Доли комнаты 0..1 (центр предмета). */
  x: number;
  y: number;
  variantKey?: string | null;
  slot?: PlaceSlot;
}

const KIND = new Map<string, (typeof ROOM_CATALOG)[number]>(ROOM_CATALOG.map((k) => [k.key, k]));

export function isRoomItemKey(key: string): key is RoomItemKey {
  return KIND.has(key);
}

export function roomItemEmoji(key: string): string {
  return KIND.get(key)?.emoji ?? '';
}

/** «спасибо за …» — винительный падеж. */
export function roomItemAcc(key: RoomItemKey): string {
  return KIND.get(key)?.acc ?? 'подарок';
}

export function spotOf(key: RoomItemKey): RoomSpot {
  return KIND.get(key)?.spot ?? 'floor';
}

/** Класс варианта по ключу 'mid:sofa' / 'free:plant' (null — без варианта). */
export function tierOf(variantKey: string | null | undefined): RoomVariantTier | null {
  const t = variantKey?.split(':')[0];
  return t === 'budget' || t === 'mid' || t === 'premium' || t === 'luxury' || t === 'free' ? t : null;
}

export function isPlaceSlot(slot: string | null | undefined): slot is PlaceSlot {
  return !!slot && Object.prototype.hasOwnProperty.call(SLOT_POS, slot);
}

/** Ячейки, куда можно поставить вид предмета (отделка — только в свою). */
export function slotsFor(key: RoomItemKey): readonly PlaceSlot[] {
  const spot = spotOf(key);
  return spot === 'wall' ? WALL_SLOTS : spot === 'floor' ? FLOOR_SLOTS : [];
}

/** Ближайшая подходящая ячейка к точке (доли сцены). */
export function nearestSlot(key: RoomItemKey, x: number, y: number): PlaceSlot | null {
  let best: PlaceSlot | null = null;
  let bestD = Infinity;
  for (const s of slotsFor(key)) {
    const p = SLOT_POS[s];
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export interface Placement {
  id: string;
  slot: RoomSlot | null;
}

/**
 * Отпустил предмет в точке (x, y) → какие перестановки отправить: защёлкнуть в
 * ближайшую подходящую ячейку; занята — соседа на освободившееся место (обмен).
 * Пусто — ничего не меняется. Чистая.
 */
export function planDrop(owned: readonly OwnedItem[], id: string, x: number, y: number): Placement[] {
  const me = owned.find((o) => o.id === id);
  if (!me) return [];
  const target = nearestSlot(me.itemKey, x, y);
  if (!target || target === me.slot) return [];
  const other = owned.find((o) => o.slot === target && o.id !== id);
  const out: Placement[] = [{ id, slot: target }];
  if (other) out.push({ id: other.id, slot: isPlaceSlot(me.slot) ? me.slot : null });
  return out;
}

/** Первая свободная подходящая ячейка (для «поставить из кладовки»). */
export function firstFreeSlot(owned: readonly OwnedItem[], key: RoomItemKey): PlaceSlot | null {
  const taken = new Set(owned.map((o) => o.slot).filter(Boolean));
  return slotsFor(key).find((s) => !taken.has(s)) ?? null;
}

/** Применить перестановки локально (оптимистично, до ответа сервера). */
export function applyPlacements(owned: readonly OwnedItem[], placements: readonly Placement[]): OwnedItem[] {
  const next = new Map(placements.map((p) => [p.id, p.slot]));
  return owned.map((o) => (next.has(o.id) ? { ...o, slot: next.get(o.id) ?? null } : o));
}

/** Что рисовать: предметы в ячейках (без отделки и кладовки) с координатами. */
export function placedItems(owned: readonly OwnedItem[]): RoomItem[] {
  return owned
    .filter((o): o is OwnedItem & { slot: PlaceSlot } => isPlaceSlot(o.slot))
    .map((o) => ({ id: o.id, itemKey: o.itemKey, variantKey: o.variantKey, slot: o.slot, ...SLOT_POS[o.slot] }));
}

/** Класс текущей отделки стен/пола (null — исходная комната). */
export function finishTier(owned: readonly OwnedItem[], kind: 'walls' | 'floor'): RoomTier | null {
  const it = owned.find((o) => o.slot === `finish-${kind}`);
  const t = tierOf(it?.variantKey);
  return t && t !== 'free' ? t : null;
}

/** Состояние кнопки в магазине: купить / не хватает / уже есть. */
export function shopState(
  v: RoomVariant,
  owned: readonly OwnedItem[],
  coins: number | null,
): { kind: 'buy' } | { kind: 'short'; need: number } | { kind: 'owned' } {
  if (v.price > 0 && owned.some((o) => o.variantKey === v.key)) return { kind: 'owned' };
  if (coins != null && coins < v.price) return { kind: 'short', need: v.price - coins };
  return { kind: 'buy' };
}
