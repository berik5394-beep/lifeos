import { useSubscriptionStore } from '@/stores/subscription-store';
import { PRO_FEATURES, DAILY_VOICE_LIMIT_FREE, FREE_FOR_ALL } from '@/stores/subscription-store';

beforeEach(() => {
  useSubscriptionStore.setState({
    tier: 'free',
    expiresAt: null,
    dailyVoiceUsed: 0,
    loading: false,
  });
  jest.clearAllMocks();
});

describe('useSubscriptionStore', () => {
  it('подписок нет — всё открыто всем', () => {
    expect(FREE_FOR_ALL).toBe(true);
  });

  it('defaults to free tier', () => {
    const state = useSubscriptionStore.getState();
    expect(state.tier).toBe('free');
    expect(state.expiresAt).toBeNull();
    expect(state.dailyVoiceUsed).toBe(0);
  });

  describe('canUseFeature', () => {
    it('returns true for non-pro features regardless of tier', () => {
      const { canUseFeature } = useSubscriptionStore.getState();
      expect(canUseFeature('basic_tasks')).toBe(true);
      expect(canUseFeature('habits')).toBe(true);
    });

    it('одна версия для всех: PRO-функции открыты и без подписки (2026-11-10)', () => {
      const { canUseFeature } = useSubscriptionStore.getState();
      for (const feature of PRO_FEATURES) expect(canUseFeature(feature)).toBe(true);
    });

    it('returns true for all features on pro tier', () => {
      useSubscriptionStore.setState({ tier: 'pro' });
      const { canUseFeature } = useSubscriptionStore.getState();

      for (const feature of PRO_FEATURES) {
        expect(canUseFeature(feature)).toBe(true);
      }
    });

    it('allows voice usage on free tier within daily limit', () => {
      useSubscriptionStore.setState({ tier: 'free', dailyVoiceUsed: 0 });
      expect(useSubscriptionStore.getState().canUseFeature('unlimited_voice')).toBe(true);
    });

    it('голос без дневного лимита — даже сверх старого лимита free', () => {
      useSubscriptionStore.setState({
        tier: 'free',
        dailyVoiceUsed: DAILY_VOICE_LIMIT_FREE,
      });
      expect(useSubscriptionStore.getState().canUseFeature('unlimited_voice')).toBe(true);
    });
  });

  describe('isProFeature', () => {
    it('returns true for pro features', () => {
      const { isProFeature } = useSubscriptionStore.getState();
      expect(isProFeature('kanban_view')).toBe(true);
      expect(isProFeature('ai_prioritization')).toBe(true);
    });

    it('returns false for non-pro features', () => {
      const { isProFeature } = useSubscriptionStore.getState();
      expect(isProFeature('basic_tasks')).toBe(false);
      expect(isProFeature('unknown_feature')).toBe(false);
    });
  });

  describe('incrementVoiceUsage', () => {
    it('increments daily voice used count', () => {
      expect(useSubscriptionStore.getState().dailyVoiceUsed).toBe(0);

      useSubscriptionStore.getState().incrementVoiceUsage();
      expect(useSubscriptionStore.getState().dailyVoiceUsed).toBe(1);

      useSubscriptionStore.getState().incrementVoiceUsage();
      expect(useSubscriptionStore.getState().dailyVoiceUsed).toBe(2);
    });
  });

  describe('DAILY_VOICE_LIMIT_FREE', () => {
    it('is defined as a positive number', () => {
      expect(DAILY_VOICE_LIMIT_FREE).toBeGreaterThan(0);
      expect(typeof DAILY_VOICE_LIMIT_FREE).toBe('number');
    });
  });
});
