/**
 * Робот-эпик, Часть 6: каталог ремонта — SSOT. Мобилка берёт его через
 * GET /room/catalog (не держит свою копию цен — не разъедется).
 *
 * 4 класса ремонта × 10 видов (стены, пол, 8 предметов) + бесплатный декор.
 * Ячейки: 7 на полу, 3 на стене, плюс отделка стен и пола — предметы не
 * накладываются, в ячейке ровно один предмет. slot = null → в кладовке.
 */
export const ROOM_TIERS = ['budget', 'mid', 'premium', 'luxury'] as const;
export type RoomTier = (typeof ROOM_TIERS)[number];

export const TIER_LABEL: Record<RoomTier | 'free' | 'friend', string> = {
  budget: 'Бюджет',
  mid: 'Средний',
  premium: 'Премиум',
  luxury: 'Люкс',
  free: 'Декор',
  friend: 'Дружба',
};

export type RoomSpot = 'floor' | 'wall' | 'finish';

/** Виды, у которых есть 4 класса. Ключи совпадают с RoomItem.itemKey. */
export const PAID_KINDS = {
  walls: { label: 'Стены', emoji: '🧱', spot: 'finish' },
  floor: { label: 'Пол', emoji: '🟫', spot: 'finish' },
  wardrobe: { label: 'Шкаф', emoji: '🗄️', spot: 'floor' },
  desk: { label: 'Стол', emoji: '🪑', spot: 'floor' },
  nightstand: { label: 'Тумбочка', emoji: '🗃️', spot: 'floor' },
  dresser: { label: 'Комод', emoji: '🧰', spot: 'floor' },
  clock: { label: 'Часы', emoji: '🕰️', spot: 'wall' },
  sofa: { label: 'Диван', emoji: '🛋️', spot: 'floor' },
  lamp: { label: 'Свет', emoji: '💡', spot: 'floor' },
  rug: { label: 'Ковёр', emoji: '🧶', spot: 'floor' },
} as const satisfies Record<string, { label: string; emoji: string; spot: RoomSpot }>;
export type PaidKind = keyof typeof PAID_KINDS;

/** Бесплатный декор (как в Части 4) — можно брать сколько угодно. */
export const FREE_KINDS = {
  plant: { label: 'Растение', emoji: '🪴', spot: 'floor' },
  picture: { label: 'Картина', emoji: '🖼️', spot: 'wall' },
  books: { label: 'Книги', emoji: '📚', spot: 'floor' },
  plush: { label: 'Игрушка', emoji: '🧸', spot: 'floor' },
} as const satisfies Record<string, { label: string; emoji: string; spot: RoomSpot }>;
export type FreeKind = keyof typeof FREE_KINDS;

/**
 * Робот-друг №4: подарки дружбы — не покупаются, открываются уровнем дружбы
 * (services/friendship.ts). По одному каждого.
 */
export const FRIEND_KINDS = {
  aquarium: { label: 'Аквариум', emoji: '🐠', spot: 'floor', minLevel: 2 },
  guitar: { label: 'Гитара', emoji: '🎸', spot: 'floor', minLevel: 3 },
  telescope: { label: 'Телескоп', emoji: '🔭', spot: 'floor', minLevel: 4 },
  trophy: { label: 'Кубок дружбы', emoji: '🏆', spot: 'floor', minLevel: 5 },
  star: { label: 'Звезда дружбы', emoji: '🌟', spot: 'wall', minLevel: 6 },
} as const satisfies Record<string, { label: string; emoji: string; spot: RoomSpot; minLevel: number }>;
export type FriendKind = keyof typeof FRIEND_KINDS;

export type RoomKind = PaidKind | FreeKind | FriendKind;

/** Название и цена варианта по классам (обзоры ремонта: см. спеку Части 6). */
const TABLE: Record<PaidKind, Record<RoomTier, [string, number]>> = {
  walls: {
    budget: ['Бумажные обои в полоску', 120],
    mid: ['Виниловые обои', 450],
    premium: ['Декоративная штукатурка', 1400],
    luxury: ['Венецианская штукатурка', 6000],
  },
  floor: {
    budget: ['Линолеум', 110],
    mid: ['Ламинат', 420],
    premium: ['Инженерная доска', 1300],
    luxury: ['Паркет «ёлочка»', 5500],
  },
  wardrobe: {
    budget: ['Шкаф ЛДСП', 90],
    mid: ['Шкаф-купе', 350],
    premium: ['Гардероб с подсветкой', 1100],
    luxury: ['Гардеробная из ореха', 4500],
  },
  desk: {
    budget: ['Стол ЛДСП', 80],
    mid: ['Письменный стол', 300],
    premium: ['Стол из массива', 1000],
    luxury: ['Стол из ореха с кожей', 4000],
  },
  nightstand: {
    budget: ['Тумбочка ЛДСП', 40],
    mid: ['Тумбочка МДФ', 200],
    premium: ['Дубовая тумбочка', 700],
    luxury: ['Тумбочка с латунью', 2500],
  },
  dresser: {
    budget: ['Комод ЛДСП', 70],
    mid: ['Комод МДФ', 280],
    premium: ['Комод в шпоне', 900],
    luxury: ['Комод с мраморной столешницей', 3500],
  },
  clock: {
    budget: ['Пластиковые часы', 40],
    mid: ['Настенные часы', 220],
    premium: ['Часы с маятником', 800],
    luxury: ['Напольные часы', 3000],
  },
  sofa: {
    budget: ['Диван-книжка', 100],
    mid: ['Угловой диван', 400],
    premium: ['Модульный диван', 1200],
    luxury: ['Бархатный итальянский диван', 5000],
  },
  lamp: {
    budget: ['Абажур', 50],
    mid: ['Торшер', 230],
    premium: ['Дизайнерская лампа', 850],
    luxury: ['Хрустальная люстра', 3200],
  },
  rug: {
    budget: ['Синтетический ковёр', 45],
    mid: ['Шерстяная дорожка', 210],
    premium: ['Шерстяной ковёр', 750],
    luxury: ['Шёлковый ковёр', 2800],
  },
};

export interface RoomVariant {
  key: string;
  kind: RoomKind;
  tier: RoomTier | 'free' | 'friend';
  label: string;
  emoji: string;
  price: number;
  spot: RoomSpot;
  /** Только у подарков дружбы: с какого уровня дружбы открыт. */
  minLevel?: number;
}

export const ROOM_VARIANTS: readonly RoomVariant[] = [
  ...ROOM_TIERS.flatMap((tier) =>
    (Object.keys(PAID_KINDS) as PaidKind[]).map((kind) => ({
      key: `${tier}:${kind}`,
      kind,
      tier,
      label: TABLE[kind][tier][0],
      emoji: PAID_KINDS[kind].emoji,
      price: TABLE[kind][tier][1],
      spot: PAID_KINDS[kind].spot,
    })),
  ),
  ...(Object.keys(FREE_KINDS) as FreeKind[]).map((kind) => ({
    key: `free:${kind}`,
    kind,
    tier: 'free' as const,
    label: FREE_KINDS[kind].label,
    emoji: FREE_KINDS[kind].emoji,
    price: 0,
    spot: FREE_KINDS[kind].spot,
  })),
  ...(Object.keys(FRIEND_KINDS) as FriendKind[]).map((kind) => ({
    key: `friend:${kind}`,
    kind,
    tier: 'friend' as const,
    label: FRIEND_KINDS[kind].label,
    emoji: FRIEND_KINDS[kind].emoji,
    price: 0,
    spot: FRIEND_KINDS[kind].spot,
    minLevel: FRIEND_KINDS[kind].minLevel,
  })),
];

const BY_KEY = new Map(ROOM_VARIANTS.map((v) => [v.key, v]));
export function variantByKey(key: string | null | undefined): RoomVariant | undefined {
  return key ? BY_KEY.get(key) : undefined;
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
export const FINISH_SLOTS = ['finish-walls', 'finish-floor'] as const;
export const ROOM_SLOTS = [...FLOOR_SLOTS, ...WALL_SLOTS, ...FINISH_SLOTS] as const;
export type RoomSlot = (typeof ROOM_SLOTS)[number];

export function isRoomSlot(s: string): s is RoomSlot {
  return (ROOM_SLOTS as readonly string[]).includes(s);
}

/** Куда можно поставить вариант: мебель — на пол, часы/картину — на стену, отделку — в свою. */
export function slotsFor(v: RoomVariant): readonly RoomSlot[] {
  if (v.spot === 'finish') return [`finish-${v.kind}` as RoomSlot];
  return v.spot === 'wall' ? WALL_SLOTS : FLOOR_SLOTS;
}

export function fitsSlot(v: RoomVariant, slot: string): boolean {
  return slotsFor(v).includes(slot as RoomSlot);
}

/** Сколько всего предметов можно иметь (с кладовкой) — защита от спама бесплатным декором. */
export const ROOM_MAX_OWNED = 80;

/** Предметы из Части 4 (бесплатные, без варианта) → бюджетный класс / декор. */
export function legacyVariantKey(itemKey: string): string | null {
  if (itemKey in FREE_KINDS) return `free:${itemKey}`;
  if (itemKey in PAID_KINDS) return `budget:${itemKey}`;
  return null;
}

// ─── Свободная расстановка (Berik 2026-11-09: «каждый юзер сам дизайнер») ────
/**
 * Мебель и декор больше не в ячейках: предмет стоит на поверхности (пол или
 * одна из стен) в точке (x, y) — доли поверхности (мобилка room-geometry.ts:
 * floor — x слева→направо, y от задней стены к зрителю; wall-left — x от
 * зрителя к задней; wall-back — x слева→направо; wall-right — x от задней к
 * зрителю; у стен y сверху вниз). surface = null — в кладовке. Ячейки (slot)
 * остались только у отделки (finish-*).
 */
export const SURFACES = ['floor', 'wall-left', 'wall-back', 'wall-right'] as const;
export type Surface = (typeof SURFACES)[number];
export type PlaceSlot = (typeof FLOOR_SLOTS)[number] | (typeof WALL_SLOTS)[number];

/** Старая ячейка → та же точка на поверхности (посчитано обратной перспективой диорамы). */
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

export function isPlaceSlot(s: string | null | undefined): s is PlaceSlot {
  return !!s && Object.prototype.hasOwnProperty.call(SLOT_SPOT, s);
}

/** Мебель — на пол, часы/картины — на любую стену. */
export function fitsSurface(v: RoomVariant, s: string): s is Surface {
  if (v.spot === 'floor') return s === 'floor';
  if (v.spot === 'wall') return s === 'wall-left' || s === 'wall-back' || s === 'wall-right';
  return false;
}

/** Для приложений до обновления: ближайшая старая ячейка той же поверхности. */
export function legacySlotOf(surface: string | null, x: number, y: number): PlaceSlot | null {
  if (!surface) return null;
  let best: PlaceSlot | null = null;
  let bd = Infinity;
  for (const [slot, p] of Object.entries(SLOT_SPOT) as Array<[PlaceSlot, (typeof SLOT_SPOT)[PlaceSlot]]>) {
    if (p.surface !== surface) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = slot;
    }
  }
  return best;
}

/**
 * Куда поставить новый предмет: первая из привычных точек, рядом с которой
 * (ближе 0.12) ещё ничего не стоит; всё занято — первая точка со сдвигом.
 */
export function defaultSpot(
  v: RoomVariant,
  placed: ReadonlyArray<{ surface: string | null; x: number; y: number }>,
): { surface: Surface; x: number; y: number } | null {
  if (v.spot === 'finish') return null;
  const order: PlaceSlot[] =
    v.spot === 'wall' ? ['wall-center', 'wall-left', 'wall-right'] : [...FLOOR_SLOTS];
  for (const s of order) {
    const p = SLOT_SPOT[s];
    const near = placed.some((o) => o.surface === p.surface && Math.hypot(o.x - p.x, o.y - p.y) < 0.12);
    if (!near) return { ...p };
  }
  const p = SLOT_SPOT[order[0]];
  const k = placed.length % 5;
  return { surface: p.surface, x: Math.min(0.94, p.x + 0.06 * k), y: Math.min(0.9, p.y + 0.04 * k) };
}
