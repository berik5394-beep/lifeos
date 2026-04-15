import { useUIStore } from '@/stores/ui-store';
import type { UIComplexity } from '@/stores/ui-store';

beforeEach(() => {
  useUIStore.setState({ complexity: 'standard' });
  jest.clearAllMocks();
});

describe('useUIStore', () => {
  it('defaults to standard complexity', () => {
    expect(useUIStore.getState().complexity).toBe('standard');
  });

  describe('setComplexity', () => {
    it('changes complexity to simple', () => {
      useUIStore.getState().setComplexity('simple');
      expect(useUIStore.getState().complexity).toBe('simple');
    });

    it('changes complexity to power', () => {
      useUIStore.getState().setComplexity('power');
      expect(useUIStore.getState().complexity).toBe('power');
    });

    it('changes complexity back to standard', () => {
      useUIStore.getState().setComplexity('power');
      useUIStore.getState().setComplexity('standard');
      expect(useUIStore.getState().complexity).toBe('standard');
    });
  });

  describe('isFeatureVisible', () => {
    const testVisibility = (
      feature: string,
      expected: Record<UIComplexity, boolean>,
    ) => {
      for (const [level, visible] of Object.entries(expected) as [UIComplexity, boolean][]) {
        it(`${feature} is ${visible ? 'visible' : 'hidden'} in ${level}`, () => {
          useUIStore.setState({ complexity: level });
          expect(useUIStore.getState().isFeatureVisible(feature)).toBe(visible);
        });
      }
    };

    describe('finance_tab', () => {
      testVisibility('finance_tab', {
        simple: false,
        standard: true,
        power: true,
      });
    });

    describe('kanban_view', () => {
      testVisibility('kanban_view', {
        simple: false,
        standard: false,
        power: true,
      });
    });

    describe('gantt_view', () => {
      testVisibility('gantt_view', {
        simple: false,
        standard: false,
        power: true,
      });
    });

    describe('focus_mode', () => {
      testVisibility('focus_mode', {
        simple: true,
        standard: true,
        power: true,
      });
    });

    describe('quick_add', () => {
      testVisibility('quick_add', {
        simple: true,
        standard: true,
        power: true,
      });
    });

    describe('journal', () => {
      testVisibility('journal', {
        simple: false,
        standard: true,
        power: true,
      });
    });

    it('returns true for unknown features', () => {
      useUIStore.setState({ complexity: 'simple' });
      expect(useUIStore.getState().isFeatureVisible('totally_unknown_feature')).toBe(true);
    });
  });
});
