import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { AnimatedCounter } from './animated-counter';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: string;
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
  style?: ViewStyle;
}

export const StatCard = React.memo(function StatCard({
  label,
  value,
  icon,
  color,
  trend,
  style,
}: StatCardProps) {
  const c = useColors();
  const resolvedColor = color ?? c.primary;

  const TREND_CONFIG = useMemo(() => ({
    up: { arrow: '\u2191', color: c.success },
    down: { arrow: '\u2193', color: c.danger },
    neutral: { arrow: '\u2192', color: c.textSecondary },
  } as const), [c]);

  const trendInfo = trend ? TREND_CONFIG[trend] : null;

  const styles = useMemo(() => StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    iconContainer: {
      width: 36,
      height: 36,
      borderRadius: borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: {
      fontSize: 18,
    },
    content: {
      gap: 2,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    valueText: {
      fontSize: fontSize.xl + 8,
      fontWeight: '700',
      color: c.text,
    },
    label: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '500',
    },
    trendArrow: {
      fontSize: fontSize.lg,
      fontWeight: '700',
    },
  }), [c]);

  return (
    <View style={[styles.card, style]}>
      {/* Icon */}
      {icon ? (
        <View style={[styles.iconContainer, { backgroundColor: resolvedColor + '20' }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      ) : null}

      {/* Value */}
      <View style={styles.content}>
        <View style={styles.valueRow}>
          {typeof value === 'number' ? (
            <AnimatedCounter value={value} size="lg" color={c.text} />
          ) : (
            <Text style={styles.valueText}>{value}</Text>
          )}
          {trendInfo ? (
            <Text style={[styles.trendArrow, { color: trendInfo.color }]}>
              {trendInfo.arrow}
            </Text>
          ) : null}
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
});
