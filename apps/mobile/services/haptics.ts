import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Centralized haptic feedback service.
 * All haptic calls are wrapped in try-catch to prevent crashes on unsupported devices.
 * Haptics are iOS-only by default (Android vibration is less refined).
 */

const isIOS = Platform.OS === 'ios';

/** Light tap — checkbox toggle, small button press */
export function hapticLight(): void {
  if (!isIOS) return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

/** Medium tap — task completion, habit check-off */
export function hapticMedium(): void {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
}

/** Heavy tap — important action, delete confirmation */
export function hapticHeavy(): void {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {}
}

/** Success — 100% day, goal achieved, streak milestone */
export function hapticSuccess(): void {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}

/** Warning — budget exceeded, missed habit */
export function hapticWarning(): void {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {}
}

/** Error — failed action, network error */
export function hapticError(): void {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {}
}

/** Selection tick — scrolling through picker, swiping cards */
export function hapticSelection(): void {
  if (!isIOS) return;
  try {
    Haptics.selectionAsync();
  } catch {}
}
