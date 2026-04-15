import React, { useMemo } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, spacing } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const Card = React.memo(function Card({ children, style }: CardProps) {
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
    },
  }), [c]);

  return <View accessible={true} style={[styles.card, style]}>{children}</View>;
});
