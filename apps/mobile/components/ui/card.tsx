import React, { useMemo } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { borderRadius, spacing } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { TapToAddArea } from './tap-to-add';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Внутри строка «Новая …»: касание по всей карточке открывает её (Berik 2026-11-09). */
  tapToAdd?: boolean;
}

export const Card = React.memo(function Card({ children, style, tapToAdd = false }: CardProps) {
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

  if (tapToAdd) return <TapToAddArea style={[styles.card, style]}>{children}</TapToAddArea>;
  return <View accessible={true} style={[styles.card, style]}>{children}</View>;
});
