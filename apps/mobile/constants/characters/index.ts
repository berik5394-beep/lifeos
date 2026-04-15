// Character types and their visual configs
export interface CharacterConfig {
  key: string;
  name: string;
  title: string;
  description: string;
  emoji: string;
  growsFrom: string;  // What habits/actions level this character
  bodyColor: string;
  armorColor: string;
  accentColor: string;
  glowColor: string;
  eyeColor: string;
}

export interface ItemConfig {
  key: string;
  name: string;
  slot: 'helmet' | 'armor' | 'weapon' | 'shield' | 'boots' | 'aura';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  rarityColor: string;
  emoji: string;
  bonus: string;
  bonusValue: number;
  description: string;
  unlockCondition: string;
  characterTypes: string[];  // Which characters can use it ('all' for universal)
}

export const CHARACTERS: CharacterConfig[] = [
  {
    key: 'warrior',
    name: 'Кронос',
    title: 'Воин Дисциплины',
    description: 'Могучий воин, закалённый в боях. Растёт от спортивных привычек и физических задач. Чем сильнее твоя дисциплина — тем мощнее его броня.',
    emoji: '⚔️',
    growsFrom: 'Спорт, тренировки, привычки',
    bodyColor: '#E8834A',
    armorColor: '#4A6741',
    accentColor: '#D4A853',
    glowColor: '#FF6B35',
    eyeColor: '#FFD700',
  },
  {
    key: 'elf',
    name: 'Аэлирия',
    title: 'Эльфийка Мудрости',
    description: 'Древняя эльфийка с острыми ушами и магическим луком. Растёт от чтения, образования и ментальных задач. Её сила — в знаниях.',
    emoji: '🏹',
    growsFrom: 'Образование, чтение, медитация',
    bodyColor: '#C4A882',
    armorColor: '#2D5A3D',
    accentColor: '#7ECFC0',
    glowColor: '#00E5A0',
    eyeColor: '#00FF88',
  },
  {
    key: 'mage',
    name: 'Игнис',
    title: 'Маг Финансов',
    description: 'Таинственный маг, управляющий потоками энергии. Растёт от финансовых целей и бюджетирования. Деньги — его магия.',
    emoji: '🔮',
    growsFrom: 'Финансы, экономия, инвестиции',
    bodyColor: '#8B7EC8',
    armorColor: '#2A1F5E',
    accentColor: '#E040FB',
    glowColor: '#9C27B0',
    eyeColor: '#E040FB',
  },
  {
    key: 'guardian',
    name: 'Титан',
    title: 'Страж Стриков',
    description: 'Несокрушимый страж с огромным щитом. Растёт от длинных стриков и ежедневных задач. Его стена непробиваема.',
    emoji: '🛡️',
    growsFrom: 'Ежедневные задачи, стрики',
    bodyColor: '#5C8FAD',
    armorColor: '#1A3A4A',
    accentColor: '#00BCD4',
    glowColor: '#0097A7',
    eyeColor: '#00E5FF',
  },
];

export const ITEMS: ItemConfig[] = [
  // --- HELMETS ---
  {
    key: 'iron_helm', name: 'Железный Шлем', slot: 'helmet', rarity: 'common', rarityColor: '#9E9E9E',
    emoji: '🪖', bonus: 'streak_shield', bonusValue: 1,
    description: '+1 день защиты стрика при пропуске',
    unlockCondition: 'Достигни 7-дневный стрик',
    characterTypes: ['all'],
  },
  {
    key: 'elven_crown', name: 'Эльфийская Корона', slot: 'helmet', rarity: 'rare', rarityColor: '#2196F3',
    emoji: '👑', bonus: 'xp_boost', bonusValue: 0.15,
    description: '+15% к получаемому опыту',
    unlockCondition: 'Прочитай 5 книг (добавь привычку чтения)',
    characterTypes: ['elf', 'mage'],
  },
  {
    key: 'dragon_helm', name: 'Шлем Дракона', slot: 'helmet', rarity: 'legendary', rarityColor: '#FF9800',
    emoji: '🐉', bonus: 'streak_shield', bonusValue: 3,
    description: '+3 дня защиты стрика',
    unlockCondition: '90-дневный стрик',
    characterTypes: ['all'],
  },

  // --- ARMOR ---
  {
    key: 'leather_armor', name: 'Кожаная Броня', slot: 'armor', rarity: 'common', rarityColor: '#9E9E9E',
    emoji: '🦺', bonus: 'health_regen', bonusValue: 5,
    description: '+5 к восстановлению здоровья питомца',
    unlockCondition: 'Выполни 50 задач',
    characterTypes: ['all'],
  },
  {
    key: 'forest_plate', name: 'Лесная Кираса', slot: 'armor', rarity: 'rare', rarityColor: '#2196F3',
    emoji: '🌿', bonus: 'happiness_boost', bonusValue: 10,
    description: '+10 к счастью питомца за каждое достижение',
    unlockCondition: 'Выполняй привычки 30 дней подряд',
    characterTypes: ['elf', 'guardian'],
  },
  {
    key: 'shadow_robe', name: 'Мантия Тени', slot: 'armor', rarity: 'epic', rarityColor: '#9C27B0',
    emoji: '🌑', bonus: 'xp_boost', bonusValue: 0.25,
    description: '+25% к опыту за финансовые цели',
    unlockCondition: 'Сэкономь бюджет 3 месяца подряд',
    characterTypes: ['mage'],
  },
  {
    key: 'titan_plate', name: 'Титановый Доспех', slot: 'armor', rarity: 'legendary', rarityColor: '#FF9800',
    emoji: '⚙️', bonus: 'health_regen', bonusValue: 20,
    description: '+20 здоровья, питомец не может умереть',
    unlockCondition: '180-дневный стрик',
    characterTypes: ['all'],
  },

  // --- WEAPONS ---
  {
    key: 'training_sword', name: 'Тренировочный Меч', slot: 'weapon', rarity: 'common', rarityColor: '#9E9E9E',
    emoji: '🗡️', bonus: 'task_xp', bonusValue: 5,
    description: '+5 XP за каждую выполненную задачу',
    unlockCondition: 'Создай первого персонажа',
    characterTypes: ['warrior', 'guardian'],
  },
  {
    key: 'elven_bow', name: 'Эльфийский Лук', slot: 'weapon', rarity: 'rare', rarityColor: '#2196F3',
    emoji: '🏹', bonus: 'habit_xp', bonusValue: 10,
    description: '+10 XP за каждую привычку',
    unlockCondition: 'Имей 5 активных привычек одновременно',
    characterTypes: ['elf'],
  },
  {
    key: 'fire_staff', name: 'Посох Огня', slot: 'weapon', rarity: 'epic', rarityColor: '#9C27B0',
    emoji: '🔥', bonus: 'finance_xp', bonusValue: 15,
    description: '+15 XP за каждую финансовую запись',
    unlockCondition: 'Записывай расходы 60 дней подряд',
    characterTypes: ['mage'],
  },
  {
    key: 'excalibur', name: 'Экскалибур', slot: 'weapon', rarity: 'legendary', rarityColor: '#FF9800',
    emoji: '✨', bonus: 'all_xp', bonusValue: 20,
    description: '+20 XP ко всем действиям',
    unlockCondition: 'Достигни 10 уровня персонажа',
    characterTypes: ['all'],
  },

  // --- SHIELDS ---
  {
    key: 'wooden_shield', name: 'Деревянный Щит', slot: 'shield', rarity: 'common', rarityColor: '#9E9E9E',
    emoji: '🪵', bonus: 'streak_shield', bonusValue: 1,
    description: '+1 день защиты стрика',
    unlockCondition: '14-дневный стрик',
    characterTypes: ['warrior', 'guardian'],
  },
  {
    key: 'mirror_shield', name: 'Зеркальный Щит', slot: 'shield', rarity: 'epic', rarityColor: '#9C27B0',
    emoji: '🪞', bonus: 'reflect_damage', bonusValue: 50,
    description: 'Питомец теряет на 50% меньше здоровья',
    unlockCondition: 'Выполни все годовые цели на 50%',
    characterTypes: ['all'],
  },

  // --- BOOTS ---
  {
    key: 'swift_boots', name: 'Ботинки Скорости', slot: 'boots', rarity: 'common', rarityColor: '#9E9E9E',
    emoji: '👟', bonus: 'step_xp', bonusValue: 1,
    description: '+1 XP за каждые 1000 шагов',
    unlockCondition: 'Пройди 100,000 шагов',
    characterTypes: ['all'],
  },
  {
    key: 'elven_sandals', name: 'Эльфийские Сандалии', slot: 'boots', rarity: 'rare', rarityColor: '#2196F3',
    emoji: '🌸', bonus: 'speed_bonus', bonusValue: 2,
    description: 'Персонаж двигается быстрее (анимация)',
    unlockCondition: 'Пройди 500,000 шагов',
    characterTypes: ['elf'],
  },

  // --- AURAS ---
  {
    key: 'focus_aura', name: 'Аура Фокуса', slot: 'aura', rarity: 'rare', rarityColor: '#2196F3',
    emoji: '💫', bonus: 'focus_time', bonusValue: 10,
    description: 'Визуальная аура вокруг персонажа',
    unlockCondition: '30-дневный стрик',
    characterTypes: ['all'],
  },
  {
    key: 'fire_aura', name: 'Огненная Аура', slot: 'aura', rarity: 'epic', rarityColor: '#9C27B0',
    emoji: '🔥', bonus: 'motivation', bonusValue: 0,
    description: 'Эпическая огненная аура',
    unlockCondition: '60-дневный стрик',
    characterTypes: ['warrior', 'mage'],
  },
  {
    key: 'divine_aura', name: 'Божественная Аура', slot: 'aura', rarity: 'legendary', rarityColor: '#FF9800',
    emoji: '☀️', bonus: 'all_boost', bonusValue: 10,
    description: '+10% ко всем бонусам. Золотое сияние.',
    unlockCondition: '365-дневный стрик',
    characterTypes: ['all'],
  },
];

export const RARITY_COLORS = {
  common: '#9E9E9E',
  rare: '#2196F3',
  epic: '#9C27B0',
  legendary: '#FF9800',
} as const;

export const RARITY_NAMES = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
} as const;

export function getCharacter(key: string): CharacterConfig | undefined {
  return CHARACTERS.find(c => c.key === key);
}

export function getItemsForCharacter(characterType: string): ItemConfig[] {
  return ITEMS.filter(item =>
    item.characterTypes.includes('all') || item.characterTypes.includes(characterType)
  );
}

export function getItemsBySlot(slot: string): ItemConfig[] {
  return ITEMS.filter(item => item.slot === slot);
}
