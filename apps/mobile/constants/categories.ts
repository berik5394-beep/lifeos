export const taskCategories = {
  work: { label: 'Работа', icon: '💼', color: '#3B82F6' },
  personal: { label: 'Личное', icon: '👤', color: '#8B5CF6' },
  health: { label: 'Здоровье', icon: '💪', color: '#22C55E' },
  finance: { label: 'Финансы', icon: '💰', color: '#F59E0B' },
  education: { label: 'Образование', icon: '📚', color: '#06B6D4' },
  home: { label: 'Дом', icon: '🏠', color: '#F97316' },
} as const;

export const habitCategories = {
  health: { label: 'Здоровье', icon: '🏃', color: '#22C55E' },
  work: { label: 'Работа', icon: '💼', color: '#3B82F6' },
  personal: { label: 'Личное', icon: '🌱', color: '#8B5CF6' },
} as const;

export const goalAreas = {
  finance: { label: 'Финансы', icon: '💰', color: '#F59E0B' },
  spirituality: { label: 'Духовность', icon: '🧘', color: '#8B5CF6' },
  career: { label: 'Карьера', icon: '🚀', color: '#3B82F6' },
  health: { label: 'Здоровье', icon: '💪', color: '#22C55E' },
  relationships: { label: 'Отношения', icon: '❤️', color: '#EC4899' },
  creativity: { label: 'Творчество', icon: '🎨', color: '#F97316' },
} as const;

export const expenseCategories = {
  food: { label: 'Еда', icon: '🍔', color: '#F97316' },
  transport: { label: 'Транспорт', icon: '🚗', color: '#3B82F6' },
  entertainment: { label: 'Развлечения', icon: '🎮', color: '#8B5CF6' },
  health: { label: 'Здоровье', icon: '💊', color: '#22C55E' },
  education: { label: 'Образование', icon: '📚', color: '#06B6D4' },
  clothing: { label: 'Одежда', icon: '👕', color: '#EC4899' },
  housing: { label: 'Жильё', icon: '🏠', color: '#F59E0B' },
  other: { label: 'Другое', icon: '📦', color: '#94A3B8' },
} as const;
