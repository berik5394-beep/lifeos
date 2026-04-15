// LifeOS Theme System — 3 themes:
// 1. dark    — deep navy (default, Трекер привычек dark blue)
// 2. planner — warm cream/ivory (Копия 2026 Планер style)
// 3. pink    — soft/gentle pink for girls

export interface Theme {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  background: string;
  surface: string;
  surfaceLight: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  divider: string;
  // Semantic
  cardShadow: string;
  tabBar: string;
  tabBarBorder: string;
  statusBar: 'light' | 'dark';
}

export type ThemeName = 'dark' | 'planner' | 'pink';

// ── Dark Navy (default) ─────────────────────────────────────
export const darkTheme: Theme = {
  primary: '#6366F1',
  secondary: '#8B5CF6',
  accent: '#E6C068',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  background: '#04102B',
  surface: '#0F1D46',
  surfaceLight: '#16275A',
  surfaceAlt: '#0A1836',
  text: '#FFFFFF',
  textSecondary: '#A8B2D1',
  textMuted: '#6B7A9E',
  border: '#1F2F5C',
  divider: '#172448',
  cardShadow: 'rgba(0,0,0,0.4)',
  tabBar: '#0F1D46',
  tabBarBorder: '#1F2F5C',
  statusBar: 'light',
} as const;

// ── Planner (Excel Планер cream/ivory) ──────────────────────
// Inspired by the user's Excel templates (Копия 2026.xlsx "Планер на неделю")
// Warm ivory paper with golden-brown accents
export const plannerTheme: Theme = {
  primary: '#8B7355',      // warm brown
  secondary: '#A0926B',    // muted gold
  accent: '#C5A55A',       // golden accent
  success: '#5D8C61',      // sage green
  warning: '#C4933F',      // amber
  danger: '#B85450',       // muted red
  background: '#F5F0E5',   // warm ivory paper
  surface: '#FFFFFF',      // white cards
  surfaceLight: '#EDE8DB', // slightly darker cream
  surfaceAlt: '#F0EBE0',   // nested panels
  text: '#2C2417',         // dark sepia
  textSecondary: '#7A7062',// warm gray
  textMuted: '#A39A8E',    // faded
  border: '#D8D0C4',       // warm light border
  divider: '#E8E2D6',      // subtle divider
  cardShadow: 'rgba(139,115,85,0.12)',
  tabBar: '#F5F0E5',
  tabBarBorder: '#D8D0C4',
  statusBar: 'dark',
} as const;

// ── Pink Soft (нежный розовый для девочек) ──────────────────
export const pinkTheme: Theme = {
  primary: '#D4829C',      // dusty rose
  secondary: '#C47A9A',    // muted mauve
  accent: '#E8A8BE',       // soft pink accent
  success: '#7CB08A',      // sage green
  warning: '#E0A96D',      // warm peach
  danger: '#D47272',       // soft coral red
  background: '#FFF5F7',   // lightest blush
  surface: '#FFFFFF',      // white cards
  surfaceLight: '#FDE8EE', // light pink tint
  surfaceAlt: '#FCEEF2',   // blush panels
  text: '#3D2033',         // dark plum
  textSecondary: '#8C6B7D',// muted rose gray
  textMuted: '#B8A0AC',    // faded lavender
  border: '#F2D5DE',       // soft pink border
  divider: '#F8E4EB',      // very light pink divider
  cardShadow: 'rgba(180,100,130,0.10)',
  tabBar: '#FFF5F7',
  tabBarBorder: '#F2D5DE',
  statusBar: 'dark',
} as const;

// Theme map for easy lookup
export const themes: Record<ThemeName, Theme> = {
  dark: darkTheme,
  planner: plannerTheme,
  pink: pinkTheme,
};

// Theme display names (Russian)
export const themeLabels: Record<ThemeName, string> = {
  dark: 'Тёмная',
  planner: 'Планер',
  pink: 'Розовая',
};

export const themeIcons: Record<ThemeName, string> = {
  dark: '🌙',
  planner: '📒',
  pink: '🌸',
};
