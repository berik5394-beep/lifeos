import React, { useEffect, useCallback } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { borderRadius } from '@/constants';
import { hapticMedium } from '@/services/haptics';
import type { ViewStyle } from 'react-native';

interface AnimatedCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

/**
 * Animated checkbox with bounce + color transition (Reanimated 4).
 * Bounces on check, smooth color fill on native thread.
 */
export const AnimatedCheckbox = React.memo(function AnimatedCheckbox({
  checked,
  onToggle,
  size = 24,
  color,
  style,
}: AnimatedCheckboxProps) {
  const c = useColors();
  const accentColor = color || c.primary;
  const progress = useSharedValue(checked ? 1 : 0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(checked ? 1 : 0, { duration: 250 });
    if (checked) {
      scale.value = withSequence(
        withSpring(1.25, { damping: 8, stiffness: 400 }),
        withSpring(1, { damping: 12, stiffness: 200 }),
      );
    }
  }, [checked, progress, scale]);

  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['transparent', accentColor]),
    borderColor: interpolateColor(progress.value, [0, 1], [c.textMuted, accentColor]),
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    hapticMedium();
    onToggle();
  }, [onToggle]);

  return (
    <Pressable onPress={handlePress} hitSlop={8} style={style}>
      <Animated.View
        style={[
          styles.box,
          { width: size, height: size },
          boxStyle,
        ]}
      >
        {checked && (
          <Feather name="check" size={Math.round(size * 0.6)} color="#FFF" />
        )}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    borderRadius: borderRadius.sm / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
