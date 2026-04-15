import React, { useEffect } from 'react';
import { type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  slideUp?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fade-in + optional slide-up entrance animation.
 * Use for list items, cards, and section reveals.
 */
export const FadeInView = React.memo(function FadeInView({
  children,
  delay = 0,
  duration = 400,
  slideUp = 12,
  style,
}: FadeInViewProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(slideUp);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.quad) }));
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration, easing: Easing.out(Easing.quad) }),
    );
  }, [delay, duration, slideUp, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
});
