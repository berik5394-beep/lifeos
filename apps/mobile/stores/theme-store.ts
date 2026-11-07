import { create } from 'zustand';
import { storage } from '@/services/storage';
import { themes, type Theme, type ThemeName } from '@/constants/themes';

const THEME_ORDER: ThemeName[] = ['dark', 'planner', 'pink'];

interface ThemeState {
  themeName: ThemeName;
  theme: Theme;
  setTheme: (name: ThemeName) => void;
  /** Cycle through: dark → planner → pink → dark */
  toggleTheme: () => void;
  /** Call after storage.load() to restore persisted theme */
  rehydrate: () => void;
}

function resolveTheme(name: ThemeName): Theme {
  return themes[name] ?? themes.dark;
}

/** Тем нет (решение Berik): всегда тёмная. Выбор «Планер/Розовая» из настроек убран,
 *  ранее выбранные возвращаются на тёмную. */
function readStoredThemeName(): ThemeName {
  return 'dark';
}

export const useThemeStore = create<ThemeState>((set) => ({
  // Start with dark; rehydrate() will restore the persisted choice after storage.load()
  themeName: 'dark',
  theme: resolveTheme('dark'),

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
