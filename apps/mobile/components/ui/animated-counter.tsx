import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type TextStyle } from 'react-native';
import { fontSize as fs } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const SIZE_MAP = {
  sm: fs.sm,
  md: 20,
  lg: 32,
  xl: 48,
} as const;

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  style?: TextStyle;
  color?: string;
  size?: keyof typeof SIZE_MAP;
}

export const AnimatedCounter = React.memo(function AnimatedCounter({
  value,
  duration = 600,
  prefix = '',
  suffix = '',
  style,
  color,
  size = 'md',
}: AnimatedCounterProps) {
  const c = useColors();
  const resolvedColor = color ?? c.text;
  const animatedValue = useRef(new Animated.Value(value)).current;
  const displayText = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const prevValue = useRef(value);
  const textRef = useRef(formatDisplay(prefix, value, suffix));

  // We use a listener to update the display text
  const [displayString, setDisplayString] = React.useState(
    formatDisplay(prefix, value, suffix),
  );

  useEffect(() => {
    if (prevValue.current === value) return;

    // Pulse animation
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.15,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 150,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    // Count animation
    const from = prevValue.current;
    const to = value;
    prevValue.current = value;

    Animated.timing(animatedValue, {
      toValue: to,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // need JS driver for text updates
    }).start();

    const listenerId = animatedValue.addListener(({ value: v }) => {
      const rounded = Math.round(v);
      const text = formatDisplay(prefix, rounded, suffix);
      if (text !== textRef.current) {
        textRef.current = text;
        setDisplayString(text);
      }
    });

    return () => {
      animatedValue.removeListener(listenerId);
    };
  }, [value, duration, prefix, suffix, animatedValue, scale]);

  const resolvedSize = SIZE_MAP[size];

  return (
    <Animated.Text
      style={[
        styles.text,
        { fontSize: resolvedSize, color: resolvedColor, transform: [{ scale }] },
        style,
      ]}
    >
      {displayString}
    </Animated.Text>
  );
});

function formatDisplay(prefix: string, val: number, suffix: string): string {
  return `${prefix}${val}${suffix}`;
}

const styles = StyleSheet.create({
  text: {
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
