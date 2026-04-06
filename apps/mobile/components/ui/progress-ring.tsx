import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { colors, fontSize } from '@/constants';

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export const ProgressRing = React.memo(function ProgressRing({
  progress,
  size = 60,
  strokeWidth = 4,
  color = colors.primary,
}: ProgressRingProps) {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const percentage = Math.round(clampedProgress * 100);

  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    animatedProgress.value = withTiming(clampedProgress, { duration: 600 });
  }, [clampedProgress, animatedProgress]);

  const rightHalfStyle = useAnimatedStyle(() => {
    const p = animatedProgress.value;
    const rightRotation = p <= 0.5 ? p * 360 : 180;
    return {
      transform: [{ rotate: `${rightRotation}deg` }],
    };
  });

  const leftHalfStyle = useAnimatedStyle(() => {
    const p = animatedProgress.value;
    const leftRotation = p > 0.5 ? (p - 0.5) * 360 : 0;
    return {
      transform: [{ rotate: `${leftRotation}deg` }],
    };
  });

  const leftContainerOpacity = useAnimatedStyle(() => ({
    opacity: animatedProgress.value > 0.5 ? 1 : 0,
  }));

  const innerSize = size - strokeWidth * 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Background circle */}
      <View
        style={[
          styles.backgroundCircle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
            borderColor: colors.surfaceLight,
          },
        ]}
      />

      {/* Right half (0-50%) */}
      <View
        style={[
          styles.halfContainer,
          {
            width: size / 2,
            height: size,
            left: size / 2,
            borderTopRightRadius: size / 2,
            borderBottomRightRadius: size / 2,
            overflow: 'hidden',
          },
        ]}
      >
        <Animated.View
          style={[
            styles.halfCircle,
            {
              width: size / 2,
              height: size,
              left: -size / 2,
              borderTopLeftRadius: size / 2,
              borderBottomLeftRadius: size / 2,
              borderWidth: strokeWidth,
              borderRightWidth: 0,
              borderColor: color,
              transformOrigin: 'right center',
            },
            rightHalfStyle,
          ]}
        />
      </View>

      {/* Left half (50-100%) */}
      <Animated.View
        style={[
          styles.halfContainer,
          {
            width: size / 2,
            height: size,
            left: 0,
            borderTopLeftRadius: size / 2,
            borderBottomLeftRadius: size / 2,
            overflow: 'hidden',
          },
          leftContainerOpacity,
        ]}
      >
        <Animated.View
          style={[
            styles.halfCircle,
            {
              width: size / 2,
              height: size,
              left: size / 2,
              borderTopRightRadius: size / 2,
              borderBottomRightRadius: size / 2,
              borderWidth: strokeWidth,
              borderLeftWidth: 0,
              borderColor: color,
              transformOrigin: 'left center',
            },
            leftHalfStyle,
          ]}
        />
      </Animated.View>

      {/* Center with percentage text */}
      <View
        style={[
          styles.center,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            top: strokeWidth,
            left: strokeWidth,
          },
        ]}
      >
        <Text
          style={[
            styles.percentageText,
            { fontSize: size < 50 ? fontSize.xs : fontSize.sm },
          ]}
        >
          {percentage}%
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  backgroundCircle: {
    position: 'absolute',
  },
  halfContainer: {
    position: 'absolute',
    top: 0,
  },
  halfCircle: {
    position: 'absolute',
    top: 0,
  },
  center: {
    position: 'absolute',
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentageText: {
    color: colors.text,
    fontWeight: '700',
  },
});
