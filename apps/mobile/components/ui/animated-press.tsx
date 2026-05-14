import React, { useCallback } from 'react';
import { Pressable, type ViewStyle, type StyleProp } from 'react-native';
import { hapticLight } from '@/services/haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleDown?: number;
  disabled?: boolean;
  haptic?: boolean;
  // A11y props — пробрасываются в Pressable, чтобы каждый callsite мог
  // указать понятный label без обходных путей.
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab' | 'checkbox' | 'switch';
  accessibilityHint?: string;
}

/**
 * Animated press component with scale-down feedback.
 * Replaces TouchableOpacity for smoother micro-interactions.
 */
export const AnimatedPress = React.memo(function AnimatedPress({
  children,
  onPress,
  onLongPress,
  style,
  scaleDown = 0.96,
  disabled = false,
  haptic = true,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
}: AnimatedPressProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(scaleDown, { damping: 15, stiffness: 300 });
    if (haptic) hapticLight();
  }, [scale, scaleDown, haptic]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  }, [scale]);

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[animatedStyle, style]}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
    >
      {children}
    </AnimatedPressable>
  );
});
