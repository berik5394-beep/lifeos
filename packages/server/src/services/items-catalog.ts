/**
 * Server-side item catalog.
 *
 * SECURITY: /pet/unlock-item MUST look up every item here before creating a
 * PetItem row. Previously the client could post arbitrary itemKey/rarity/bonus
 * values and mint legendary gear for free, dominating the arena.
 *
 * Each entry declares the unlock condition so the server can verify.
 */

export type ItemSlot = 'helmet' | 'armor' | 'weapon' | 'shield' | 'boots' | 'aura';
export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ItemSpec {
  itemKey: string;
  name: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  bonus?: string;
  bonusValue: number;
  /**
   * Unlock condition evaluated against the user's pet + arena stats.
   * Returns null if OK, or a Russian error message if the user hasn't earned it.
   */
  condition: (ctx: UnlockContext) => string | null;
}

export interface UnlockContext {
  petLevel: number;
  petStreak: number;
  arenaWins: number;
  arenaTrophies: number;
}

const minLevel = (n: number) => (ctx: UnlockContext) =>
  ctx.petLevel >= n ? null : `Нужен уровень ${n} (у тебя ${ctx.petLevel})`;

const minStreak = (n: number) => (ctx: UnlockContext) =>
  ctx.petStreak >= n ? null : `Нужна серия ${n} дней (у тебя ${ctx.petStreak})`;

const minWins = (n: number) => (ctx: UnlockContext) =>
  ctx.arenaWins >= n ? null : `Нужно ${n} побед в арене (у тебя ${ctx.arenaWins})`;

const minTrophies = (n: number) => (ctx: UnlockContext) =>
  ctx.arenaTrophies >= n
    ? null
    : `Нужно ${n} трофеев (у тебя ${ctx.arenaTrophies})`;

export const ITEMS_CATALOG: Record<string, ItemSpec> = {
  // ===== STARTERS (unlocked at level 1) =====
  cloth_hood: {
    itemKey: 'cloth_hood',
    name: 'Тканевый капюшон',
    slot: 'helmet',
    rarity: 'common',
    bonus: 'defense',
    bonusValue: 5,
    condition: minLevel(1),
  },
  wooden_sword: {
    itemKey: 'wooden_sword',
    name: 'Деревянный меч',
    slot: 'weapon',
    rarity: 'common',
    bonus: 'attack',
    bonusValue: 5,
    condition: minLevel(1),
  },
  leather_vest: {
    itemKey: 'leather_vest',
    name: 'Кожаный жилет',
    slot: 'armor',
    rarity: 'common',
    bonus: 'defense',
    bonusValue: 8,
    condition: minLevel(1),
  },
  worn_boots: {
    itemKey: 'worn_boots',
    name: 'Поношенные сапоги',
    slot: 'boots',
    rarity: 'common',
    bonus: 'speed',
    bonusValue: 3,
    condition: minLevel(1),
  },

  // ===== RARE (level 5-10) =====
  iron_helmet: {
    itemKey: 'iron_helmet',
    name: 'Железный шлем',
    slot: 'helmet',
    rarity: 'rare',
    bonus: 'defense',
    bonusValue: 15,
    condition: minLevel(5),
  },
  iron_sword: {
    itemKey: 'iron_sword',
    name: 'Железный меч',
    slot: 'weapon',
    rarity: 'rare',
    bonus: 'attack',
    bonusValue: 15,
    condition: minLevel(5),
  },
  chain_mail: {
    itemKey: 'chain_mail',
    name: 'Кольчуга',
    slot: 'armor',
    rarity: 'rare',
    bonus: 'defense',
    bonusValue: 20,
    condition: minLevel(8),
  },
  iron_shield: {
    itemKey: 'iron_shield',
    name: 'Железный щит',
    slot: 'shield',
    rarity: 'rare',
    bonus: 'defense',
    bonusValue: 18,
    condition: minLevel(7),
  },

  // ===== EPIC (level 15+, streaks, arena) =====
  knight_helm: {
    itemKey: 'knight_helm',
    name: 'Рыцарский шлем',
    slot: 'helmet',
    rarity: 'epic',
    bonus: 'defense',
    bonusValue: 30,
    condition: minLevel(15),
  },
  flame_sword: {
    itemKey: 'flame_sword',
    name: 'Огненный меч',
    slot: 'weapon',
    rarity: 'epic',
    bonus: 'attack',
    bonusValue: 35,
    condition: minStreak(14),
  },
  storm_aura: {
    itemKey: 'storm_aura',
    name: 'Аура бури',
    slot: 'aura',
    rarity: 'epic',
    bonus: 'all',
    bonusValue: 20,
    condition: minWins(10),
  },
  plate_armor: {
    itemKey: 'plate_armor',
    name: 'Латная броня',
    slot: 'armor',
    rarity: 'epic',
    bonus: 'defense',
    bonusValue: 40,
    condition: minLevel(18),
  },

  // ===== LEGENDARY (serious grind) =====
  crown_of_kings: {
    itemKey: 'crown_of_kings',
    name: 'Корона королей',
    slot: 'helmet',
    rarity: 'legendary',
    bonus: 'all',
    bonusValue: 50,
    condition: minStreak(30),
  },
  dragon_blade: {
    itemKey: 'dragon_blade',
    name: 'Клинок дракона',
    slot: 'weapon',
    rarity: 'legendary',
    bonus: 'attack',
    bonusValue: 60,
    condition: minLevel(30),
  },
  golden_wings: {
    itemKey: 'golden_wings',
    name: 'Золотые крылья',
    slot: 'aura',
    rarity: 'legendary',
    bonus: 'all',
    bonusValue: 55,
    condition: minTrophies(1000),
  },
  phoenix_mantle: {
    itemKey: 'phoenix_mantle',
    name: 'Мантия феникса',
    slot: 'armor',
    rarity: 'legendary',
    bonus: 'defense',
    bonusValue: 70,
    condition: minStreak(60),
  },
  thunder_boots: {
    itemKey: 'thunder_boots',
    name: 'Сапоги грома',
    slot: 'boots',
    rarity: 'legendary',
    bonus: 'speed',
    bonusValue: 40,
    condition: minWins(50),
  },
};

/**
 * Validate an unlock request. Returns the verified ItemSpec or an error message.
 */
export function validateUnlock(
  itemKey: string,
  ctx: UnlockContext,
): { ok: true; item: ItemSpec } | { ok: false; error: string } {
  const spec = ITEMS_CATALOG[itemKey];
  if (!spec) {
    return { ok: false, error: `Неизвестный предмет: ${itemKey}` };
  }
  const err = spec.condition(ctx);
  if (err) {
    return { ok: false, error: err };
  }
  return { ok: true, item: spec };
}
