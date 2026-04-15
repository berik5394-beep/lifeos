import { useMemo } from 'react';
import { useThemeStore } from '@/stores/theme-store';
import type { Theme } from '@/constants/themes';

/**
 * Returns current theme colors. Use this in components instead of
 * importing static `colors` from constants when you want theme-reactivity.
 *
 * Usage:
 *   const c = useColors();
 *   <View style={{ backgroundColor: c.background }} />
 */
export function useColors(): Theme {
  return useThemeStore((s) => s.theme);
}

/**
 * Non-hook version for use outside React components (e.g., navigation config).
 * Returns the current theme snapshot — NOT reactive.
 */
export function getColors(): Theme {
  return useThemeStore.getState().theme;
}
