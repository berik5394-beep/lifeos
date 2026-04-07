import { create } from 'zustand';

interface AppState {
  onboardingDone: boolean;
  setOnboardingDone: (done: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  onboardingDone: false,
  setOnboardingDone: (done) => set({ onboardingDone: done }),
}));
