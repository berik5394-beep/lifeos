import { create } from 'zustand';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';

const PRO_FEATURES = [
  'unlimited_voice',
  'jarvis_full',
  'ai_prioritization',
  'kanban_view',
  'gantt_view',
  'all_themes',
  'advanced_analytics',
  'export_reports',
  'shared_spaces_10',
  'all_costumes',
] as const;

type ProFeature = (typeof PRO_FEATURES)[number];

const DAILY_VOICE_LIMIT_FREE = 3;
const STORAGE_KEY_TIER = 'subscription_tier';
const STORAGE_KEY_EXPIRES = 'subscription_expires';
const STORAGE_KEY_VOICE_USED = 'daily_voice_used';
const STORAGE_KEY_VOICE_DATE = 'daily_voice_date';

interface SubscriptionResponse {
  tier: 'free' | 'pro';
  expiresAt: string | null;
}

interface SubscriptionState {
  tier: 'free' | 'pro';
  expiresAt: string | null;
  dailyVoiceUsed: number;
  loading: boolean;
  loadSubscription: () => Promise<void>;
  isProFeature: (feature: string) => boolean;
  canUseFeature: (feature: string) => boolean;
  incrementVoiceUsage: () => void;
  rehydrate: () => void;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  tier: (storage.getString(STORAGE_KEY_TIER) as 'free' | 'pro') || 'free',
  expiresAt: storage.getString(STORAGE_KEY_EXPIRES) || null,
  dailyVoiceUsed: 0,
  loading: false,

  loadSubscription: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    set({ loading: true });
    try {
      const data = await api.get<SubscriptionResponse>('/subscription', token);
      storage.set(STORAGE_KEY_TIER, data.tier);
      if (data.expiresAt) {
        storage.set(STORAGE_KEY_EXPIRES, data.expiresAt);
      } else {
        storage.remove(STORAGE_KEY_EXPIRES);
      }
      set({
        tier: data.tier,
        expiresAt: data.expiresAt,
        loading: false,
      });
    } catch {
      // Use cached values on error
      set({ loading: false });
    }
  },

  isProFeature: (feature: string) => {
    return (PRO_FEATURES as readonly string[]).includes(feature);
  },

  canUseFeature: (feature: string) => {
    const state = get();
    if (state.tier === 'pro') return true;
    if (!(PRO_FEATURES as readonly string[]).includes(feature)) return true;

    // Special case: voice commands have daily limit for free tier
    if (feature === 'unlimited_voice') {
      return state.dailyVoiceUsed < DAILY_VOICE_LIMIT_FREE;
    }

    return false;
  },

  incrementVoiceUsage: () => {
    const today = getTodayString();
    const savedDate = storage.getString(STORAGE_KEY_VOICE_DATE);

    let currentUsed = get().dailyVoiceUsed;
    if (savedDate !== today) {
      // New day, reset counter
      currentUsed = 0;
    }

    const newUsed = currentUsed + 1;
    storage.set(STORAGE_KEY_VOICE_USED, String(newUsed));
    storage.set(STORAGE_KEY_VOICE_DATE, today);
    set({ dailyVoiceUsed: newUsed });
  },

  rehydrate: () => {
    const tier = (storage.getString(STORAGE_KEY_TIER) as 'free' | 'pro') || 'free';
    const expiresAt = storage.getString(STORAGE_KEY_EXPIRES) || null;
    const today = getTodayString();
    const savedDate = storage.getString(STORAGE_KEY_VOICE_DATE);
    let dailyVoiceUsed = 0;

    if (savedDate === today) {
      const savedUsed = storage.getString(STORAGE_KEY_VOICE_USED);
      dailyVoiceUsed = savedUsed ? parseInt(savedUsed, 10) : 0;
      if (isNaN(dailyVoiceUsed)) dailyVoiceUsed = 0;
    }

    set({ tier, expiresAt, dailyVoiceUsed });
  },
}));

export { PRO_FEATURES, DAILY_VOICE_LIMIT_FREE };
