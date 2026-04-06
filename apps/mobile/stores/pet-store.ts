import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

export type PetType = 'cat' | 'dog' | 'fox' | 'owl' | 'dragon';
export type PetStage = 'baby' | 'teen' | 'adult' | 'master' | 'legend';
export type PetState =
  | 'happy'
  | 'content'
  | 'normal'
  | 'sad'
  | 'sick'
  | 'hungry'
  | 'sleepy'
  | 'sleeping'
  | 'celebrating'
  | 'exercising'
  | 'dead';

export type ReviveMethod = 'perfect_day' | 'double_steps' | 'three_days';

export interface Pet {
  id: string;
  type: PetType;
  name: string;
  health: number;
  happiness: number;
  streak: number;
  lastFed: string;
  lastPlayed: string;
  costume: string | null;
  level: number;
  xp: number;
  xpToNext: number;
  stage: PetStage;
  isAlive: boolean;
  diedAt: string | null;
  lastActive: string;
  roomLevel: number;
}

export interface CostumeInfo {
  key: string;
  name: string;
  emoji: string;
  unlocked: boolean;
  equipped: boolean;
}

export interface HealthBreakdown {
  habits: number;
  tasks: number;
  budget: number;
  steps: number;
  journal: number;
  meals: number;
}

export interface PetData {
  pet: Pet;
  state: PetState;
  healthBreakdown: HealthBreakdown;
}

interface PetStore {
  petData: PetData | null;
  costumes: CostumeInfo[];
  isLoading: boolean;
  lastReaction: string | null;
  fetchPet: () => Promise<void>;
  feedPet: () => Promise<void>;
  playWithPet: () => Promise<void>;
  renamePet: (name: string) => Promise<void>;
  setPetType: (type: PetType) => Promise<void>;
  triggerReaction: (reaction: string) => void;
  revivePet: (method: ReviveMethod) => Promise<void>;
  fetchCostumes: () => Promise<void>;
  setCostume: (costume: string) => Promise<void>;
}

export const usePetStore = create<PetStore>((set) => ({
  petData: null,
  costumes: [],
  isLoading: false,
  lastReaction: null,

  fetchPet: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    set({ isLoading: true });
    try {
      const data = await api.get<PetData>('/pet', token);
      set({ petData: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  feedPet: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.put<PetData>('/pet/feed', {}, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },

  playWithPet: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.put<PetData>('/pet/play', {}, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },

  renamePet: async (name: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.put<PetData>('/pet/name', { name }, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },

  setPetType: async (type: PetType) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.put<PetData>('/pet/type', { type }, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },

  triggerReaction: (reaction: string) => {
    set({ lastReaction: reaction });
    setTimeout(() => {
      set({ lastReaction: null });
    }, 2000);
  },

  revivePet: async (method: ReviveMethod) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.post<PetData>('/pet/revive', { method }, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },

  fetchCostumes: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.get<CostumeInfo[]>('/pet/costumes', token);
      set({ costumes: data });
    } catch {
      // Error handled silently
    }
  },

  setCostume: async (costume: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const data = await api.put<PetData>('/pet/costume', { costume }, token);
      set({ petData: data });
    } catch {
      // Error handled silently
    }
  },
}));
