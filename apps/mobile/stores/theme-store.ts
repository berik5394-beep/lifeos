import { create } from 'zustand';
import { storage } from '@/services/storage';
import { darkTheme, lightTheme, type Theme, type ThemeName } from '@/constants/themes';

interface ThemeState {
  themeName: ThemeName;
  theme: Theme;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
}

function resolveTheme(name: ThemeName): Theme {
  return name === 'light' ? lightTheme : darkTheme;
}

function loadStoredThemeName(): ThemeName {
  const stored = storage.getString('themeName');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

const initialThemeName = loadStoredThemeName();

export const useThemeStore = create<ThemeState>((set) => ({
  themeName: initialThemeName,
  theme: resolveTheme(initialThemeName),

  setTheme: (name: ThemeName) => {
    storage.set('themeName', name);
    set({ themeName: name, theme: resolveTheme(name) });
  },

  toggleTheme: () => {
    set((state) => {
      const next: ThemeName = state.themeName === 'dark' ? 'light' : 'dark';
      storage.set('themeName', next);
      return { themeName: next, theme: resolveTheme(next) };
    });
  },
}));
