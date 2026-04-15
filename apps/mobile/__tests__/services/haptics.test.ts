import * as Haptics from 'expo-haptics';
import {
  hapticLight,
  hapticMedium,
  hapticHeavy,
  hapticSuccess,
  hapticWarning,
  hapticError,
  hapticSelection,
} from '@/services/haptics';

// Mock Platform to test iOS behavior
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('haptics service', () => {
  it('hapticLight does not throw', () => {
    expect(() => hapticLight()).not.toThrow();
  });

  it('hapticMedium does not throw', () => {
    expect(() => hapticMedium()).not.toThrow();
  });

  it('hapticHeavy does not throw', () => {
    expect(() => hapticHeavy()).not.toThrow();
  });

  it('hapticSuccess does not throw', () => {
    expect(() => hapticSuccess()).not.toThrow();
  });

  it('hapticWarning does not throw', () => {
    expect(() => hapticWarning()).not.toThrow();
  });

  it('hapticError does not throw', () => {
    expect(() => hapticError()).not.toThrow();
  });

  it('hapticSelection does not throw', () => {
    expect(() => hapticSelection()).not.toThrow();
  });

  it('hapticLight calls Haptics.impactAsync with Light style on iOS', () => {
    hapticLight();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('hapticMedium calls Haptics.impactAsync with Medium style', () => {
    hapticMedium();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
  });

  it('hapticSuccess calls Haptics.notificationAsync with Success type', () => {
    hapticSuccess();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it('hapticSelection calls Haptics.selectionAsync on iOS', () => {
    hapticSelection();
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  });
});
