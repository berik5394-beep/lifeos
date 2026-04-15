/**
 * VoiceWaveform — визуализация голосовой амплитуды в виде анимированных полосок.
 *
 * Показывает 5 вертикальных полосок, высота которых реагирует на amplitude (0-1).
 * Центральная полоска — самая высокая, боковые — ниже.
 */

import React, { useEffect, useRef, memo } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/use-colors';

interface VoiceWaveformProps {
  amplitude: number; // 0-1
  isActive: boolean;
  color?: string;
  barCount?: number;
  width?: number;
  height?: number;
}

const BAR_WEIGHTS = [0.4, 0.7, 1.0, 0.7, 0.4]; // Center is tallest

function VoiceWaveformInner({
  amplitude,
  isActive,
  color,
  barCount = 5,
  width = 80,
  height = 40,
}: VoiceWaveformProps) {
  const c = useColors();
  const barColor = color ?? c.primary;

  // Create animated values for each bar
  const barAnims = useRef<Animated.Value[]>(
    Array.from({ length: barCount }, () => new Animated.Value(0.15)),
  ).current;

  useEffect(() => {
    if (!isActive) {
      // Reset all bars to minimum
      barAnims.forEach((anim) => {
        Animated.timing(anim, {
          toValue: 0.15,
          duration: 200,
          useNativeDriver: false,
        }).start();
      });
      return;
    }

    // Animate each bar to weighted amplitude
    const weights =
      barCount === 5
        ? BAR_WEIGHTS
        : Array.from({ length: barCount }, (_, i) => {
            const center = (barCount - 1) / 2;
            const dist = Math.abs(i - center) / center;
            return 1 - dist * 0.6;
          });

    barAnims.forEach((anim, i) => {
      const weight = weights[i] ?? 0.5;
      // Add slight randomness for natural feel
      const jitter = (Math.random() - 0.5) * 0.15;
      const target = Math.max(0.15, Math.min(1, amplitude * weight + jitter));

      Animated.spring(anim, {
        toValue: target,
        friction: 5,
        tension: 100,
        useNativeDriver: false,
      }).start();
    });
  }, [amplitude, isActive, barAnims, barCount]);

  const barWidth = Math.max(3, (width - (barCount - 1) * 4) / barCount);

  return (
    <View style={[styles.container, { width, height }]}>
      {barAnims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              width: barWidth,
              backgroundColor: barColor,
              height: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [4, height],
              }),
              opacity: isActive ? 1 : 0.3,
            },
          ]}
        />
      ))}
    </View>
  );
}

export const VoiceWaveform = memo(VoiceWaveformInner);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  bar: {
    borderRadius: 2,
  },
});
