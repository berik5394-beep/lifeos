import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, borderRadius, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';

export interface WeekDay {
  label: string;     // "Пн", "Вт" ...
  dateNum?: number;  // day-of-month number
  completed?: number; // bar fill 0-1 OR checkbox count
  total?: number;
  active?: boolean;
}

interface WeekGridProps {
  caption?: string;
  days: WeekDay[];
  style?: StyleProp<ViewStyle>;
}

// Seven-day grid matching the "НЕДЕЛЯ" layout in Трекер привычек (dark blue).
// Each day is a small bordered tile showing label + number + tiny bar.
export const WeekGrid = React.memo(function WeekGrid({
  caption,
  days,
  style,
}: WeekGridProps) {
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    wrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
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
      gap: 6,
    },
    cell: {
      flex: 1,
      backgroundColor: c.surfaceAlt,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: 4,
      alignItems: 'center',
      gap: 4,
    },
    cellActive: {
      borderColor: c.accent,
      backgroundColor: c.surfaceLight,
    },
    dayLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    dayLabelActive: {
      color: c.accent,
    },
    dayNum: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '800',
    },
    dayNumActive: {
      color: c.accent,
    },
    bar: {
      width: '100%',
      height: 3,
      borderRadius: 2,
      backgroundColor: c.divider,
      overflow: 'hidden',
      marginTop: 2,
    },
    barFill: {
      height: '100%',
      backgroundColor: c.primary,
    },
    barFillFull: {
      backgroundColor: c.accent,
    },
    countText: {
      color: c.textMuted,
      fontSize: 9,
      fontWeight: '700',
    },
  }), [c]);

  return (
    <View style={[styles.wrap, style]}>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      <View style={styles.row}>
        {days.map((d, idx) => {
          const pct =
            d.total && d.total > 0
              ? Math.max(0, Math.min(1, (d.completed ?? 0) / d.total))
              : 0;
          return (
            <View
              key={`${d.label}-${idx}`}
              style={[styles.cell, d.active && styles.cellActive]}
            >
              <Text style={[styles.dayLabel, d.active && styles.dayLabelActive]}>
                {d.label}
              </Text>
              {d.dateNum !== undefined && (
                <Text style={[styles.dayNum, d.active && styles.dayNumActive]}>
                  {d.dateNum}
                </Text>
              )}
              <View style={styles.bar}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct * 100}%` },
                    pct >= 1 && styles.barFillFull,
                  ]}
                />
              </View>
              {d.total ? (
                <Text style={styles.countText}>
                  {d.completed ?? 0}/{d.total}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
});
