import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, Animated, Easing, StyleSheet, type ViewStyle } from 'react-native';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface AnimatedProgressBarProps {
  progress: number; // 0-100
  height?: number;
  color?: string;
  trackColor?: string;
  showLabel?: boolean;
  animated?: boolean;
  style?: ViewStyle;
}

export const AnimatedProgressBar = React.memo(function AnimatedProgressBar({
  progress,
  height = 8,
  color,
  trackColor,
  showLabel = false,
  animated = true,
  style,
}: AnimatedProgressBarProps) {
  const c = useColors();
  const resolvedColor = color ?? c.success;
  const resolvedTrackColor = trackColor ?? c.surfaceLight;
  const clamped = Math.min(100, Math.max(0, progress));
  const animatedWidth = useRef(new Animated.Value(animated ? 0 : clamped)).current;

  useEffect(() => {
    if (animated) {
      Animated.timing(animatedWidth, {
        toValue: clamped,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      animatedWidth.setValue(clamped);
    }
  }, [clamped, animated, animatedWidth]);

  const widthInterpolation = animatedWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const styles = useMemo(() => StyleSheet.create({
    wrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    track: {
      flex: 1,
      overflow: 'hidden',
    },
    fill: {
      shadowColor: c.success,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 4,
      elevation: 3,
    },
    label: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.textSecondary,
      minWidth: 36,
      textAlign: 'right',
    },
  }), [c]);

  return (
    <View style={[styles.wrapper, style]}>
      <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: resolvedTrackColor }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              height,
              borderRadius: height / 2,
              backgroundColor: resolvedColor,
              width: widthInterpolation,
            },
          ]}
        />
      </View>
      {showLabel && (
        <Text style={styles.label}>{Math.round(clamped)}%</Text>
      )}
    </View>
  );
});
