import { create } from 'zustand';
import { storage } from '@/services/storage';
import { themes, type Theme, type ThemeName } from '@/constants/themes';

const THEME_ORDER: ThemeName[] = ['planner', 'dark', 'pink'];
/** По умолчанию — светлая «слоновая кость» (Berik 2026-11-07). */
export const DEFAULT_THEME: ThemeName = 'planner';

interface ThemeState {
  themeName: ThemeName;
  theme: Theme;
  setTheme: (name: ThemeName) => void;
  /** По кругу: планер → тёмная → розовая → планер */
  toggleTheme: () => void;
  /** Call after storage.load() to restore persisted theme */
  rehydrate: () => void;
}

function resolveTheme(name: ThemeName): Theme {
  return themes[name] ?? themes[DEFAULT_THEME];
}

/** Выбранный в настройках фон; не выбирал (или мусор) — светлая «слоновая кость». */
export function readStoredThemeName(): ThemeName {
  const v = storage.getString('themeName');
  return v && v in themes ? (v as ThemeName) : DEFAULT_THEME;
}

export const useThemeStore = create<ThemeState>((set) => ({
  // Сразу светлая (без вспышки тёмной); rehydrate() после storage.load() вернёт выбранную.
  themeName: DEFAULT_THEME,
  theme: resolveTheme(DEFAULT_THEME),

  setTheme: (name: ThemeName) => {
    storage.set('themeName', name);
    set({ themeName: name, theme: resolveTheme(name) });
  },

  toggleTheme: () => {
    set((state) => {
      const currentIdx = THEME_ORDER.indexOf(state.themeName);
      const nextIdx = (currentIdx + 1) % THEME_ORDER.length;
      const next = THEME_ORDER[nextIdx];
      storage.set('themeName', next);
      return { themeName: next, theme: resolveTheme(next) };
    });
  },

  rehydrate: () => {
    const name = readStoredThemeName();
    set({ themeName: name, theme: resolveTheme(name) });
  },
}));
