// Palette inspired by premium planner templates (Копия Трекер привычек dark blue,
// Копия Финансовый Планер, Копия Трекер задач). Deep navy base, white ink,
// soft gold accent for streaks/highlights.
export const colors = {
  primary: '#6366F1',
  secondary: '#8B5CF6',
  accent: '#E6C068', // soft gold for highlights / streaks
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  // Template navy
  background: '#04102B',     // page background (Финансовый Планер)
  surface: '#0F1D46',        // cards / panels (Трекер привычек dark-blue)
  surfaceLight: '#16275A',   // elevated surface
  surfaceAlt: '#0A1836',     // nested panel
  text: '#FFFFFF',
  textSecondary: '#A8B2D1',
  // Bumped from #6B7A9E to clear WCAG AA body-text contrast (4.5:1) on
  // surface #0F1D46 and background #04102B. Previous value was 3.57:1 on
  // surface — App Store accessibility review blocker.
  textMuted: '#8B96B8',
  border: '#1F2F5C',
  divider: '#172448',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  hero: 36,
} as const;

// Typography helpers — the templates use all-caps bold section titles
// with wide letter spacing and a thin letter weight for body copy.
export const typography = {
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: '#A8B2D1',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    color: '#FFFFFF',
  },
  heroNumber: {
    fontSize: 36,
    fontWeight: '900' as const,
    letterSpacing: -0.5,
    color: '#FFFFFF',
  },
} as const;
