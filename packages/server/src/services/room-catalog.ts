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

export const TIER_LABEL: Record<RoomTier | 'free', string> = {
  budget: 'Бюджет',
  mid: 'Средний',
  premium: 'Премиум',
  luxury: 'Люкс',
  free: 'Декор',
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

export type RoomKind = PaidKind | FreeKind;

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
  tier: RoomTier | 'free';
  label: string;
  emoji: string;
  price: number;
  spot: RoomSpot;
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
