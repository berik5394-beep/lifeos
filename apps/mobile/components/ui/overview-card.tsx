import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, borderRadius, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';

export interface OverviewStat {
  label: string;
  value: string | number;
  // Optional accent color for the value (e.g. success green, danger red).
  color?: string;
  // Optional trailing unit (e.g. "₸", "%", "дней").
  unit?: string;
}

interface OverviewCardProps {
  // Left-column big number (hero KPI).
  heroValue?: string | number;
  heroLabel?: string;
  heroUnit?: string;
  // Optional header caption above the hero value (e.g. "ОБЗОР").
  caption?: string;
  // Right-column list of compact stats rendered under each other.
  stats?: OverviewStat[];
  // Free children slot (e.g. for a progress bar) rendered below the hero row.
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Overview card pattern inspired by Финансовый Планер "Обзор" section —
// big left-side KPI + stacked right-side mini stats, thin border, navy fill.
export const OverviewCard = React.memo(function OverviewCard({
  caption,
  heroValue,
  heroLabel,
  heroUnit,
  stats,
  children,
  style,
}: OverviewCardProps) {
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    caption: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '800',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    heroCol: {
      flex: 1.1,
      justifyContent: 'center',
      paddingRight: spacing.sm,
      borderRightWidth: 1,
      borderRightColor: c.divider,
    },
    heroValue: {
      color: c.text,
      fontSize: fontSize.hero,
      fontWeight: '900',
      letterSpacing: -0.8,
    },
    heroUnit: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.textSecondary,
    },
    heroLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: 4,
    },
    statsCol: {
      flex: 1.3,
      justifyContent: 'center',
      gap: 4,
    },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    statRowBordered: {
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    statLabel: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '500',
      flexShrink: 1,
      marginRight: spacing.sm,
    },
    statValue: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '800',
    },
    statUnit: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
  }), [c]);

  return (
    <View style={[styles.card, style]}>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      <View style={styles.row}>
        {heroValue !== undefined && (
          <View style={styles.heroCol}>
            <Text style={styles.heroValue}>
              {heroValue}
              {heroUnit ? <Text style={styles.heroUnit}> {heroUnit}</Text> : null}
            </Text>
            {heroLabel ? <Text style={styles.heroLabel}>{heroLabel}</Text> : null}
          </View>
        )}
        {stats && stats.length > 0 && (
          <View style={styles.statsCol}>
            {stats.map((s, idx) => (
              <View
                key={`${s.label}-${idx}`}
                style={[styles.statRow, idx < stats.length - 1 && styles.statRowBordered]}
              >
                <Text style={styles.statLabel}>{s.label}</Text>
                <Text style={[styles.statValue, s.color ? { color: s.color } : null]}>
                  {s.value}
                  {s.unit ? <Text style={styles.statUnit}> {s.unit}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {children}
    </View>
  );
});
