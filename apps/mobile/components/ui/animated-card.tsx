import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';
import { colors, borderRadius, spacing } from '@/constants';

interface AnimatedCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  delay?: number;
  index?: number;
}

export const AnimatedCard = React.memo(function AnimatedCard({
  children,
  style,
  delay,
  index,
}: AnimatedCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  const animationDelay = delay ?? (index ?? 0) * 100;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 400,
      delay: animationDelay,
      useNativeDriver: true,
    }).start();

    Animated.timing(translateY, {
      toValue: 0,
      duration: 400,
      delay: animationDelay,
      useNativeDriver: true,
    }).start();
  }, [animationDelay, opacity, translateY]);

  return (
    <Animated.View style={[styles.card, { opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
