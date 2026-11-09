import { surfaceToScene, type Surface } from './room-geometry';
/**
 * Робот-эпик, Части 4–6: комната робота. Цены и варианты — SSOT на сервере
 * (GET /room/catalog, packages/server/src/services/room-catalog.ts); здесь —
 * то, что нужно только экрану: виды предметов (значок, падеж для благодарности),
 * привычные места на рисунке комнаты и чистая логика свободной расстановки.
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
  // Робот-друг №4: подарки дружбы (открываются уровнем дружбы, не покупаются).
  { key: 'aquarium', emoji: '🐠', label: 'Аквариум', acc: 'аквариум', spot: 'floor' },
  { key: 'guitar', emoji: '🎸', label: 'Гитара', acc: 'гитару', spot: 'floor' },
  { key: 'telescope', emoji: '🔭', label: 'Телескоп', acc: 'телескоп', spot: 'floor' },
  { key: 'trophy', emoji: '🏆', label: 'Кубок дружбы', acc: 'кубок дружбы', spot: 'floor' },
  { key: 'star', emoji: '🌟', label: 'Звезда дружбы', acc: 'звезду дружбы', spot: 'wall' },
] as const;

export type RoomItemKey = (typeof ROOM_CATALOG)[number]['key'];
export type RoomSpot = 'floor' | 'wall' | 'finish';
export type RoomTier = 'budget' | 'mid' | 'premium' | 'luxury';
export type RoomVariantTier = RoomTier | 'free' | 'friend';

export const ROOM_TIERS: readonly RoomTier[] = ['budget', 'mid', 'premium', 'luxury'];
export const TIER_LABEL: Record<RoomVariantTier, string> = {
  budget: 'Бюджет',
  mid: 'Средний',
  premium: 'Премиум',
  luxury: 'Люкс',
  free: 'Декор',
  friend: 'Дружба',
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
  /** Подарок дружбы: с какого уровня дружбы открыт. */
  minLevel?: number;
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

/**
 * Купленный предмет (как отдаёт сервер). Мебель стоит на поверхности
 * (surface + x, y — доли поверхности, см. room-geometry Surface); surface = null
 * и нет slot — в кладовке. slot у отделки — finish-walls/finish-floor
 * (у мебели сервер шлёт ближайшую старую ячейку — для приложений до обновления).
 */
export interface OwnedItem {
  id: string;
  itemKey: RoomItemKey;
  variantKey: string | null;
  slot: RoomSlot | null;
  surface?: Surface | null;
  x?: number;
  y?: number;
}

/** Предмет на рисунке. */
export interface RoomItem {
  id: string;
  itemKey: RoomItemKey;
  surface: Surface;
  /** Точка на поверхности (доли). */
  u: number;
  v: number;
  /** Где он на экране при обычном виде (доли сцены) — порядок по глубине, подсказки робота. */
  x: number;
  y: number;
  variantKey?: string | null;
}

const KIND = new Map<string, (typeof ROOM_CATALOG)[number]>(ROOM_CATALOG.map((k) => [k.key, k]));

export function isRoomItemKey(key: string): key is RoomItemKey {
  return KIND.has(key);
}

export function roomItemEmoji(key: string): string {
  return KIND.get(key)?.emoji ?? '';
}

/** Название предмета по-русски («Шкаф»); незнакомый — «Предмет». */
export function roomItemLabel(key: string): string {
  return KIND.get(key)?.label ?? 'Предмет';
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
  return t === 'budget' || t === 'mid' || t === 'premium' || t === 'luxury' || t === 'free' || t === 'friend' ? t : null;
}

export function isPlaceSlot(slot: string | null | undefined): slot is PlaceSlot {
  return !!slot && Object.prototype.hasOwnProperty.call(SLOT_POS, slot);
}

/** Ячейки вида (историческое; мебель теперь ставится свободно — см. defaultSpot). */
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

/** Перестановка: мебель — точка на поверхности (surface null — в кладовку), отделка — ячейка. */
export type Placement =
  | { id: string; surface: Surface | null; x?: number; y?: number }
  | { id: string; slot: RoomSlot | null };

/** Отделка (finish) — в ячейке; остальное — на поверхности. */
export function isFinish(o: OwnedItem): boolean {
  return spotOf(o.itemKey) === 'finish';
}

/** Стоит ли в комнате (не в кладовке). */
export function isPlaced(o: OwnedItem): boolean {
  return isFinish(o) ? !!o.slot : !!o.surface;
}

/**
 * Старая ячейка → та же точка на поверхности (зеркало сервера SLOT_SPOT,
 * посчитано обратной перспективой диорамы). Привычные места для новых вещей.
 */
export const SLOT_SPOT: Record<PlaceSlot, { surface: Surface; x: number; y: number }> = {
  'floor-back-left': { surface: 'floor', x: 0.218, y: 0.27 },
  'floor-back-center': { surface: 'floor', x: 0.5, y: 0.24 },
  'floor-back-right': { surface: 'floor', x: 0.782, y: 0.27 },
  'floor-mid-left': { surface: 'floor', x: 0.116, y: 0.581 },
  'floor-mid-right': { surface: 'floor', x: 0.884, y: 0.581 },
  'floor-front-left': { surface: 'floor', x: 0.093, y: 0.85 },
  'floor-front-right': { surface: 'floor', x: 0.907, y: 0.85 },
  'wall-left': { surface: 'wall-left', x: 0.401, y: 0.497 },
  'wall-center': { surface: 'wall-back', x: 0.5, y: 0.167 },
  'wall-right': { surface: 'wall-right', x: 0.599, y: 0.497 },
};

/** Куда поставить вещь из кладовки: первое привычное место, рядом с которым пусто (зеркало сервера). */
export function defaultSpot(owned: readonly OwnedItem[], key: RoomItemKey): { surface: Surface; x: number; y: number } | null {
  const spot = spotOf(key);
  if (spot === 'finish') return null;
  const order: PlaceSlot[] = spot === 'wall' ? ['wall-center', 'wall-left', 'wall-right'] : [...FLOOR_SLOTS];
  const placed = owned.filter((o) => o.surface);
  for (const s of order) {
    const p = SLOT_SPOT[s];
    if (!placed.some((o) => o.surface === p.surface && Math.hypot((o.x ?? 0) - p.x, (o.y ?? 0) - p.y) < 0.12)) return { ...p };
  }
  const p = SLOT_SPOT[order[0]];
  const k = placed.length % 5;
  return { surface: p.surface, x: Math.min(0.94, p.x + 0.06 * k), y: Math.min(0.9, p.y + 0.04 * k) };
}

/** Применить перестановки локально (оптимистично, до ответа сервера). */
export function applyPlacements(owned: readonly OwnedItem[], placements: readonly Placement[]): OwnedItem[] {
  const next = new Map(placements.map((p) => [p.id, p]));
  return owned.map((o) => {
    const p = next.get(o.id);
    if (!p) return o;
    if ('slot' in p) return { ...o, slot: p.slot };
    return p.surface ? { ...o, slot: null, surface: p.surface, x: p.x, y: p.y } : { ...o, slot: null, surface: null };
  });
}

/** Что рисовать: мебель на поверхностях (без отделки и кладовки). */
export function placedItems(owned: readonly OwnedItem[]): RoomItem[] {
  return owned
    .filter((o) => !isFinish(o) && !!o.surface)
    .map((o) => {
      const surface = o.surface as Surface;
      const u = o.x ?? 0.5;
      const v = o.y ?? 0.5;
      const at = surfaceToScene(1, 1, { x: 0, y: 0 }, surface, u, v);
      return { id: o.id, itemKey: o.itemKey, variantKey: o.variantKey, surface, u, v, x: at.x, y: at.y };
    });
}

/** Класс текущей отделки стен/пола (null — исходная комната). */
export function finishTier(owned: readonly OwnedItem[], kind: 'walls' | 'floor'): RoomTier | null {
  const it = owned.find((o) => o.slot === `finish-${kind}`);
  const t = tierOf(it?.variantKey);
  return t && t !== 'free' && t !== 'friend' ? t : null;
}

/** Состояние кнопки в магазине: купить / не хватает / уже есть / закрыт уровнем дружбы. */
export function shopState(
  v: RoomVariant,
  owned: readonly OwnedItem[],
  coins: number | null,
  friendLevel: number | null = null,
): { kind: 'buy' } | { kind: 'short'; need: number } | { kind: 'owned' } | { kind: 'locked'; minLevel: number } {
  if ((v.price > 0 || v.tier === 'friend') && owned.some((o) => o.variantKey === v.key)) return { kind: 'owned' };
  if (v.minLevel && (friendLevel ?? 1) < v.minLevel) return { kind: 'locked', minLevel: v.minLevel };
  if (coins != null && coins < v.price) return { kind: 'short', need: v.price - coins };
  return { kind: 'buy' };
}
