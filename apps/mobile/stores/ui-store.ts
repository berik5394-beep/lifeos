import { create } from 'zustand';
import { storage } from '@/services/storage';

export type UIComplexity = 'simple' | 'standard' | 'power';

const FEATURE_LEVELS: Record<string, UIComplexity[]> = {
  finance_tab: ['standard', 'power'],
  goals_tab: ['standard', 'power'],
  kanban_view: ['power'],
  gantt_view: ['power'],
  dependencies: ['power'],
  shared_spaces: ['power'],
  ai_prioritization: ['standard', 'power'],
  tags_filters: ['standard', 'power'],
  focus_mode: ['simple', 'standard', 'power'],
  quick_add: ['simple', 'standard', 'power'],
  pet_widget: ['standard', 'power'],
  journal: ['standard', 'power'],
  export_reports: ['power'],
  heatmap_year: ['power'],
  advanced_analytics: ['power'],
};

interface UIState {
  complexity: UIComplexity;
  setComplexity: (c: UIComplexity) => void;
  isFeatureVisible: (feature: string) => boolean;
  rehydrate: () => void;
}

const STORAGE_KEY = 'ui_complexity';

export const useUIStore = create<UIState>((set, get) => ({
  complexity: (storage.getString(STORAGE_KEY) as UIComplexity) || 'standard',

  setComplexity: (c: UIComplexity) => {
    storage.set(STORAGE_KEY, c);
    set({ complexity: c });
  },

  isFeatureVisible: (feature: string) => {
    const levels = FEATURE_LEVELS[feature];
    if (!levels) return true; // unknown features are visible by default
    return levels.includes(get().complexity);
  },

  rehydrate: () => {
    const saved = storage.getString(STORAGE_KEY) as UIComplexity | undefined;
    if (saved && ['simple', 'standard', 'power'].includes(saved)) {
      set({ complexity: saved });
    }
  },
}));

export { FEATURE_LEVELS };
